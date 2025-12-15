import pytest
from unittest.mock import patch, MagicMock, call

from src.lambda_function.discovery.base import DiscoveredResource
from src.lambda_function.discovery.tag_discovery import TagDiscovery

@pytest.fixture
def mock_boto_client():
    """Fixture to mock the boto3 client and its get_resources method."""
    with patch('src.lambda_function.discovery.tag_discovery.boto3.client') as mock_boto3_client:
        mock_rg_tag_client = MagicMock()
        mock_boto3_client.return_value = mock_rg_tag_client
        yield mock_rg_tag_client

def test_tag_discovery_initialization(mock_boto_client):
    """Tests the initialization of TagDiscovery."""
    tag_filters = {'lights-out:managed': 'true'}
    resource_types = ['ecs:service']
    discovery = TagDiscovery(tag_filters=tag_filters, resource_types=resource_types)
    assert discovery.tag_filters == tag_filters
    assert discovery.resource_types == resource_types

def test_discover_no_resources_found(mock_boto_client):
    """Tests discovery when no resources match the tags."""
    mock_boto_client.get_resources.return_value = {
        'ResourceTagMappingList': [],
        'PaginationToken': ''
    }
    
    discovery = TagDiscovery(tag_filters={'app': 'my-app'}, resource_types=['ecs:service'])
    resources = discovery.discover()
    
    assert resources == []
    mock_boto_client.get_resources.assert_called_once_with(
        TagFilters=[{'Key': 'app', 'Values': ['my-app']}],
        ResourceTypeFilters=['ecs:service']
    )

def test_discover_single_resource_with_defaults(mock_boto_client):
    """Tests discovering a single resource with default priority and group."""
    mock_boto_client.get_resources.return_value = {
        'ResourceTagMappingList': [
            {
                'ResourceARN': 'arn:aws:ecs:us-east-1:123456789012:service/my-cluster/my-service',
                'Tags': [
                    {'Key': 'Name', 'Value': 'my-web-app'},
                    {'Key': 'lights-out:managed', 'Value': 'true'},
                ]
            }
        ],
        'PaginationToken': ''
    }

    discovery = TagDiscovery(tag_filters={'lights-out:managed': 'true'}, resource_types=['ecs:service'])
    discovered = discovery.discover()

    assert len(discovered) == 1
    res = discovered[0]
    assert isinstance(res, DiscoveredResource)
    assert res.resource_type == 'ecs-service'
    assert res.arn == 'arn:aws:ecs:us-east-1:123456789012:service/my-cluster/my-service'
    assert res.resource_id == 'my-cluster/my-service'
    assert res.priority == 50  # Default
    assert res.group == 'default'  # Default
    assert res.tags == {'Name': 'my-web-app', 'lights-out:managed': 'true'}
    assert res.metadata == {'cluster_name': 'my-cluster'}

def test_discover_resource_with_custom_tags(mock_boto_client):
    """Tests discovering a resource with custom priority and group tags."""
    mock_boto_client.get_resources.return_value = {
        'ResourceTagMappingList': [
            {
                'ResourceARN': 'arn:aws:ecs:ap-south-1:123456789012:service/another-cluster/api-service',
                'Tags': [
                    {'Key': 'lights-out:priority', 'Value': '100'},
                    {'Key': 'lights-out:group', 'Value': 'critical'},
                ]
            }
        ],
        'PaginationToken': ''
    }

    discovery = TagDiscovery(tag_filters={}, resource_types=[])
    discovered = discovery.discover()

    assert len(discovered) == 1
    res = discovered[0]
    assert res.priority == 100
    assert res.group == 'critical'
    assert res.resource_id == 'another-cluster/api-service'

def test_discover_with_invalid_priority_tag(mock_boto_client):
    """Tests that an invalid priority tag falls back to the default."""
    mock_boto_client.get_resources.return_value = {
        'ResourceTagMappingList': [
            {
                'ResourceARN': 'arn:aws:ecs:ap-south-1:123456789012:service/another-cluster/api-service',
                'Tags': [
                    {'Key': 'lights-out:priority', 'Value': 'high'}, # Invalid value
                ]
            }
        ],
        'PaginationToken': ''
    }

    discovery = TagDiscovery(tag_filters={}, resource_types=[])
    discovered = discovery.discover()
    assert len(discovered) == 1
    assert discovered[0].priority == 50 # Falls back to default

def test_discover_handles_pagination(mock_boto_client):
    """Tests that the discover method correctly handles paginated API responses."""
    mock_boto_client.get_resources.side_effect = [
        {
            'ResourceTagMappingList': [
                {'ResourceARN': 'arn:aws:ecs:us-east-1:123456789012:service/cluster1/service1', 'Tags': []}
            ],
            'PaginationToken': 'next-token'
        },
        {
            'ResourceTagMappingList': [
                {'ResourceARN': 'arn:aws:ecs:us-east-1:123456789012:service/cluster2/service2', 'Tags': []}
            ],
            'PaginationToken': ''
        }
    ]

    discovery = TagDiscovery(tag_filters={'k': 'v'}, resource_types=['ecs:service'])
    discovered = discovery.discover()

    assert len(discovered) == 2
    assert mock_boto_client.get_resources.call_count == 2
    
    # Check that the second call used the token from the first
    first_call = call(TagFilters=[{'Key': 'k', 'Values': ['v']}], ResourceTypeFilters=['ecs:service'])
    second_call = call(TagFilters=[{'Key': 'k', 'Values': ['v']}], ResourceTypeFilters=['ecs:service'], PaginationToken='next-token')
    mock_boto_client.get_resources.assert_has_calls([first_call, second_call])
    
    arns = {res.arn for res in discovered}
    assert 'arn:aws:ecs:us-east-1:123456789012:service/cluster1/service1' in arns
    assert 'arn:aws:ecs:us-east-1:123456789012:service/cluster2/service2' in arns

@pytest.mark.parametrize("arn, resource_type, expected_id, expected_metadata", [
    (
        "arn:aws:ecs:us-east-1:123456789012:service/my-cluster/my-service", 
        "ecs:service", 
        "my-cluster/my-service", 
        {'cluster_name': 'my-cluster'}
    ),
    (
        "arn:aws:ecs:us-east-1:123456789012:service/my-service-no-cluster", 
        "ecs:service", 
        "my-service-no-cluster", 
        {'cluster_name': 'default'}
    ),
    (
        "arn:aws:ec2:us-west-2:123456789012:instance/i-1234567890abcdef0",
        "ec2:instance",
        "i-1234567890abcdef0",
        {}
    ),
    (
        "arn:aws:rds:eu-west-1:123456789012:db:my-db-instance",
        "rds:db",
        "my-db-instance",
        {}
    ),
    (
        "arn:aws:rds:eu-west-1:123456789012:cluster:my-aurora-cluster",
        "rds:cluster",
        "my-aurora-cluster",
        {}
    ),
    (   "unsupported-arn",
        "unknown",
        "unsupported-arn",
        {}
    ),
])
def test_parse_resource_id_and_metadata(arn, resource_type, expected_id, expected_metadata):
    """Tests the ARN parsing logic for various resource types."""
    res_id, metadata = TagDiscovery._parse_resource_id_and_metadata(arn, resource_type)
    assert res_id == expected_id
    assert metadata == expected_metadata
