import boto3
from typing import List, Dict, Tuple, Any

from src.lambda_function.discovery.base import DiscoveredResource, ResourceDiscovery
from src.lambda_function.utils.logger import setup_logger

# Setup module logger with structured JSON output
logger = setup_logger(__name__)

class TagDiscovery(ResourceDiscovery):
    """
    Discovers resources based on AWS resource tags.
    """

    # Constants for default values
    DEFAULT_PRIORITY = 50
    DEFAULT_GROUP = 'default'

    def __init__(self, tag_filters: Dict[str, str], resource_types: List[str]):
        """
        Initializes the TagDiscovery strategy.

        Args:
            tag_filters: A dictionary of tags to filter resources by.
                         e.g., {'lights-out:managed': 'true'}
            resource_types: A list of AWS resource types to scan.
                            e.g., ['ecs:service']
        """
        self.tag_filters = tag_filters
        self.resource_types = resource_types
        self.rg_tag_client = boto3.client('resourcegroupstaggingapi')

    def discover(self) -> List[DiscoveredResource]:
        """
        Finds all resources matching the configured tags and resource types.
        Handles pagination from the get_resources API.

        Returns:
            List of discovered resources with parsed metadata
        """
        discovered_resources = []
        tag_filters_list = self._build_tag_filters(self.tag_filters)

        # Manual pagination handling
        pagination_token = ''
        while True:
            # Build request parameters
            params = {
                'TagFilters': tag_filters_list,
                'ResourceTypeFilters': self.resource_types
            }
            if pagination_token:
                params['PaginationToken'] = pagination_token

            # Fetch resources from AWS
            response = self.rg_tag_client.get_resources(**params)

            # Process each resource in the response
            for resource_map in response.get('ResourceTagMappingList', []):
                discovered_resource = self._process_resource_mapping(resource_map)
                discovered_resources.append(discovered_resource)

            # Check for more pages
            pagination_token = response.get('PaginationToken', '')
            if not pagination_token:
                break

        return discovered_resources

    def _process_resource_mapping(self, resource_map: Dict[str, Any]) -> DiscoveredResource:
        """
        Processes a single resource mapping from AWS API response.

        Args:
            resource_map: Resource mapping object from get_resources API

        Returns:
            DiscoveredResource object with parsed information
        """
        # Extract and transform tags
        tags = {tag['Key']: tag['Value'] for tag in resource_map.get('Tags', [])}
        arn = resource_map['ResourceARN']

        # Extract lights-out specific metadata
        priority = self._extract_priority_from_tags(tags, arn)
        group = tags.get('lights-out:group', self.DEFAULT_GROUP)

        # Parse ARN to get resource type and ID
        aws_resource_type = self._extract_resource_type_from_arn(arn)
        resource_id, metadata = self._parse_resource_id_and_metadata(arn, aws_resource_type)
        internal_resource_type = aws_resource_type.replace(':', '-')

        return DiscoveredResource(
            resource_type=internal_resource_type,
            arn=arn,
            resource_id=resource_id,
            priority=priority,
            group=group,
            tags=tags,
            metadata=metadata
        )

    def _extract_priority_from_tags(self, tags: Dict[str, str], arn: str) -> int:
        """
        Extracts and validates priority from resource tags.

        Args:
            tags: Dictionary of resource tags
            arn: Resource ARN for logging purposes

        Returns:
            Valid priority as integer, or DEFAULT_PRIORITY if invalid
        """
        priority_str = tags.get('lights-out:priority', str(self.DEFAULT_PRIORITY))
        try:
            return int(priority_str)
        except (ValueError, TypeError):
            logger.warning(
                f"Invalid priority '{priority_str}' on resource {arn}. "
                f"Falling back to default {self.DEFAULT_PRIORITY}."
            )
            return self.DEFAULT_PRIORITY

    @staticmethod
    def _build_tag_filters(tag_filters: Dict[str, str]) -> List[Dict[str, Any]]:
        """
        Converts tag filters dictionary to AWS API format.

        Args:
            tag_filters: Dictionary of tag key-value pairs

        Returns:
            List of tag filter objects for AWS API
        """
        return [{"Key": k, "Values": [v]} for k, v in tag_filters.items()]

    @staticmethod
    def _extract_resource_type_from_arn(arn: str) -> str:
        """
        Extracts the resource type from an ARN.

        ARN format: arn:aws:service:region:account:resource-type/resource-id

        Examples:
            - arn:aws:ecs:us-east-1:123456789012:service/my-cluster/my-service → ecs:service
            - arn:aws:ec2:us-west-2:123456789012:instance/i-1234567890abcdef0 → ec2:instance
            - arn:aws:rds:eu-west-1:123456789012:db:my-db-instance → rds:db
            - arn:aws:rds:eu-west-1:123456789012:cluster:my-aurora-cluster → rds:cluster
        """
        parts = arn.split(':')
        if len(parts) < 6:
            return 'unknown'

        service = parts[2]  # e.g., 'ecs', 'ec2', 'rds'
        resource_part = parts[5]  # e.g., 'service/...', 'instance/...', 'db:...', 'cluster:...'

        # Extract the resource type (first part before '/' or ':')
        if '/' in resource_part:
            resource_type = resource_part.split('/')[0]
        elif ':' in resource_part:
            resource_type = resource_part.split(':')[0]
        else:
            resource_type = resource_part

        return f"{service}:{resource_type}"

    @staticmethod
    def _parse_resource_id_and_metadata(arn: str, resource_type: str) -> Tuple[str, Dict[str, Any]]:
        """
        Parses an ARN to extract a human-readable resource ID and any relevant metadata.

        Examples:
            - ECS: arn:aws:ecs:region:account:service/cluster/service-name
                   → resource_id="cluster/service-name", metadata={'cluster_name': 'cluster'}
            - ECS: arn:aws:ecs:region:account:service/service-name
                   → resource_id="service-name", metadata={'cluster_name': 'default'}
            - EC2: arn:aws:ec2:region:account:instance/i-xxxxx
                   → resource_id="i-xxxxx", metadata={}
            - RDS: arn:aws:rds:region:account:db:db-name
                   → resource_id="db-name", metadata={}
        """
        parts = arn.split(':')
        if len(parts) < 6:
            # Malformed ARN, return as-is
            return arn, {}

        resource_id_part = parts[-1]
        metadata = {}

        if resource_type == 'ecs:service':
            # arn:aws:ecs:region:account-id:service/cluster-name/service-name
            # or arn:aws:ecs:region:account-id:service/service-name
            resource_parts = resource_id_part.split('/')
            if len(resource_parts) >= 3:
                # Format: service/cluster-name/service-name
                cluster_name = resource_parts[-2]
                service_name = resource_parts[-1]
                metadata['cluster_name'] = cluster_name
                return f"{cluster_name}/{service_name}", metadata
            elif len(resource_parts) == 2:
                # Format: service/service-name (no cluster)
                service_name = resource_parts[-1]
                metadata['cluster_name'] = 'default'
                return service_name, metadata
            else:
                # Unexpected format
                metadata['cluster_name'] = 'default'
                return resource_id_part, metadata

        if resource_type == 'ec2:instance':
            # arn:aws:ec2:region:account-id:instance/i-12345
            if '/' in resource_id_part:
                return resource_id_part.split('/')[-1], {}
            return resource_id_part, {}

        if resource_type in ('rds:db', 'rds:cluster'):
            # arn:aws:rds:region:account-id:db:my-db-instance
            # arn:aws:rds:region:account-id:cluster:my-aurora-cluster
            if ':' in resource_id_part:
                return resource_id_part.split(':')[-1], {}
            return resource_id_part, {}

        # Unsupported resource type or malformed ARN
        return arn, {}
