"""Configuration management with AWS SSM Parameter Store support."""
import json
import os
from typing import Optional

import boto3
from botocore.exceptions import ClientError

from .logger import setup_logger
from .models import LightsOutConfig

logger = setup_logger(__name__)


class ConfigurationError(Exception):
    """Exception raised for configuration errors."""
    pass


def load_config_from_ssm(parameter_name: str, region: Optional[str] = None) -> LightsOutConfig:
    """Load configuration from AWS SSM Parameter Store.
    
    Args:
        parameter_name: Name of the SSM parameter
        region: AWS region (defaults to AWS_REGION env var or us-east-1)
    
    Returns:
        Parsed LightsOutConfig
    
    Raises:
        ConfigurationError: If parameter cannot be loaded or parsed
    """
    region = region or os.environ.get("AWS_REGION", "us-east-1")
    
    try:
        ssm = boto3.client("ssm", region_name=region)
        logger.info(f"Loading configuration from SSM parameter: {parameter_name}")
        
        response = ssm.get_parameter(Name=parameter_name, WithDecryption=True)
        config_json = response["Parameter"]["Value"]
        
        logger.info("Successfully loaded configuration from SSM")
        return parse_config(config_json)
        
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "Unknown")
        if error_code == "ParameterNotFound":
            raise ConfigurationError(f"SSM parameter not found: {parameter_name}")
        raise ConfigurationError(f"Failed to load SSM parameter: {str(e)}")
    except Exception as e:
        raise ConfigurationError(f"Unexpected error loading configuration: {str(e)}")


def parse_config(config_json: str) -> LightsOutConfig:
    """Parse JSON configuration string into LightsOutConfig.
    
    Args:
        config_json: JSON string containing configuration
    
    Returns:
        Parsed LightsOutConfig
    
    Raises:
        ConfigurationError: If JSON is invalid or doesn't match schema
    """
    try:
        config_dict = json.loads(config_json)
        return LightsOutConfig(**config_dict)
    except json.JSONDecodeError as e:
        raise ConfigurationError(f"Invalid JSON configuration: {str(e)}")
    except Exception as e:
        raise ConfigurationError(f"Configuration validation failed: {str(e)}")


def get_config(ssm_parameter: Optional[str] = None) -> LightsOutConfig:
    """Get configuration from SSM or environment variables.
    
    Attempts to load from SSM if parameter name is provided via argument
    or LIGHTS_OUT_CONFIG_PARAM env var. Falls back to default config.
    
    Also respects DRY_RUN environment variable override.
    
    Args:
        ssm_parameter: Optional SSM parameter name
    
    Returns:
        LightsOutConfig instance
    """
    # Check for SSM parameter name
    param_name = ssm_parameter or os.environ.get("LIGHTS_OUT_CONFIG_PARAM")
    
    if param_name:
        try:
            config = load_config_from_ssm(param_name)
        except ConfigurationError as e:
            logger.warning(f"Failed to load config from SSM: {e}. Using defaults.")
            config = LightsOutConfig()
    else:
        logger.info("No SSM parameter specified, using default configuration")
        config = LightsOutConfig()
    
    # Override dry_run from environment variable if set
    dry_run_env = os.environ.get("DRY_RUN", "").lower()
    if dry_run_env in ("true", "1", "yes"):
        logger.info("DRY_RUN environment variable set to true")
        config.dry_run = True
    elif dry_run_env in ("false", "0", "no"):
        config.dry_run = False
    
    logger.info(f"Configuration loaded: dry_run={config.dry_run}, tag_key={config.tag_key}")
    return config
