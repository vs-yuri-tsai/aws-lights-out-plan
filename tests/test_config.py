"""Tests for configuration management."""
import json
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from lights_out.core.config import (
    ConfigurationError,
    get_config,
    load_config_from_ssm,
    parse_config,
)
from lights_out.core.models import LightsOutConfig


def test_parse_config_valid():
    """Test parsing valid JSON configuration."""
    config_json = json.dumps({
        "tag_key": "TestTag",
        "tag_value": "test",
        "dry_run": True
    })
    
    config = parse_config(config_json)
    assert isinstance(config, LightsOutConfig)
    assert config.tag_key == "TestTag"
    assert config.tag_value == "test"
    assert config.dry_run is True


def test_parse_config_invalid_json():
    """Test parsing invalid JSON raises ConfigurationError."""
    with pytest.raises(ConfigurationError, match="Invalid JSON"):
        parse_config("{invalid json")


def test_parse_config_invalid_schema():
    """Test parsing JSON with invalid schema raises ConfigurationError."""
    config_json = json.dumps({
        "resources": [
            {"resource_type": "invalid", "priority": -1}
        ]
    })
    
    with pytest.raises(ConfigurationError, match="validation failed"):
        parse_config(config_json)


@patch("lights_out.core.config.boto3.client")
def test_load_config_from_ssm_success(mock_boto_client):
    """Test successful SSM parameter load."""
    mock_ssm = MagicMock()
    mock_boto_client.return_value = mock_ssm
    
    config_dict = {
        "tag_key": "SSMTag",
        "tag_value": "ssm"
    }
    mock_ssm.get_parameter.return_value = {
        "Parameter": {
            "Value": json.dumps(config_dict)
        }
    }
    
    config = load_config_from_ssm("/test/param", region="us-west-2")
    
    assert config.tag_key == "SSMTag"
    assert config.tag_value == "ssm"
    mock_boto_client.assert_called_once_with("ssm", region_name="us-west-2")
    mock_ssm.get_parameter.assert_called_once_with(
        Name="/test/param",
        WithDecryption=True
    )


@patch("lights_out.core.config.boto3.client")
def test_load_config_from_ssm_not_found(mock_boto_client):
    """Test SSM parameter not found raises ConfigurationError."""
    from botocore.exceptions import ClientError
    
    mock_ssm = MagicMock()
    mock_boto_client.return_value = mock_ssm
    
    mock_ssm.get_parameter.side_effect = ClientError(
        {"Error": {"Code": "ParameterNotFound"}},
        "GetParameter"
    )
    
    with pytest.raises(ConfigurationError, match="parameter not found"):
        load_config_from_ssm("/test/param")


@patch("lights_out.core.config.boto3.client")
def test_get_config_with_ssm(mock_boto_client):
    """Test get_config loads from SSM when parameter is provided."""
    mock_ssm = MagicMock()
    mock_boto_client.return_value = mock_ssm
    
    config_dict = {"tag_key": "FromSSM"}
    mock_ssm.get_parameter.return_value = {
        "Parameter": {"Value": json.dumps(config_dict)}
    }
    
    config = get_config(ssm_parameter="/test/param")
    assert config.tag_key == "FromSSM"


@patch.dict(os.environ, {"LIGHTS_OUT_CONFIG_PARAM": "/env/param"})
@patch("lights_out.core.config.boto3.client")
def test_get_config_with_env_var(mock_boto_client):
    """Test get_config loads from SSM using env var."""
    mock_ssm = MagicMock()
    mock_boto_client.return_value = mock_ssm
    
    config_dict = {"tag_key": "FromEnv"}
    mock_ssm.get_parameter.return_value = {
        "Parameter": {"Value": json.dumps(config_dict)}
    }
    
    config = get_config()
    assert config.tag_key == "FromEnv"


def test_get_config_default():
    """Test get_config returns default when no SSM parameter."""
    config = get_config()
    assert isinstance(config, LightsOutConfig)
    assert config.tag_key == "LightsOut"
    assert config.tag_value == "enabled"


@patch.dict(os.environ, {"DRY_RUN": "true"})
def test_get_config_dry_run_env_true():
    """Test DRY_RUN environment variable override to true."""
    config = get_config()
    assert config.dry_run is True


@patch.dict(os.environ, {"DRY_RUN": "false"})
def test_get_config_dry_run_env_false():
    """Test DRY_RUN environment variable override to false."""
    config = get_config()
    assert config.dry_run is False


@patch.dict(os.environ, {"DRY_RUN": "1"})
def test_get_config_dry_run_numeric():
    """Test DRY_RUN with numeric value."""
    config = get_config()
    assert config.dry_run is True


@patch("lights_out.core.config.boto3.client")
def test_get_config_ssm_fallback(mock_boto_client):
    """Test get_config falls back to default when SSM fails."""
    mock_ssm = MagicMock()
    mock_boto_client.return_value = mock_ssm
    
    from botocore.exceptions import ClientError
    mock_ssm.get_parameter.side_effect = ClientError(
        {"Error": {"Code": "ParameterNotFound"}},
        "GetParameter"
    )
    
    config = get_config(ssm_parameter="/missing/param")
    assert isinstance(config, LightsOutConfig)
    assert config.tag_key == "LightsOut"  # Default value
