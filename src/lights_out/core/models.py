"""Pydantic models for AWS Lights Out configuration and resources."""
from enum import Enum
from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class ResourceType(str, Enum):
    """Supported AWS resource types."""
    EC2 = "ec2"
    RDS = "rds"
    ASG = "asg"  # Auto Scaling Group


class ActionType(str, Enum):
    """Action types for resources."""
    START = "start"
    STOP = "stop"


class ResourceConfig(BaseModel):
    """Configuration for a resource type."""
    model_config = ConfigDict(use_enum_values=True)
    
    resource_type: ResourceType
    priority: int = Field(ge=0, description="Priority for start/stop order (lower starts first)")
    enabled: bool = True


class LightsOutConfig(BaseModel):
    """Main configuration model for Lights Out."""
    model_config = ConfigDict(use_enum_values=True)
    
    tag_key: str = Field(default="LightsOut", description="Tag key to look for on resources")
    tag_value: str = Field(default="enabled", description="Tag value that enables lights out")
    resources: List[ResourceConfig] = Field(
        default_factory=lambda: [
            ResourceConfig(resource_type=ResourceType.RDS, priority=1),
            ResourceConfig(resource_type=ResourceType.EC2, priority=2),
            ResourceConfig(resource_type=ResourceType.ASG, priority=3),
        ],
        description="Resource configurations with priorities"
    )
    dry_run: bool = Field(default=False, description="If true, only log actions without executing")


class Resource(BaseModel):
    """Model representing a discovered AWS resource."""
    model_config = ConfigDict(use_enum_values=True)
    
    resource_id: str
    resource_type: ResourceType
    resource_arn: str
    tags: Dict[str, str] = Field(default_factory=dict)
    priority: int = 0
    region: Optional[str] = None


class ActionResult(BaseModel):
    """Result of a start/stop action."""
    model_config = ConfigDict(use_enum_values=True)
    
    resource_id: str
    resource_type: ResourceType
    action: ActionType
    success: bool
    message: str
    dry_run: bool = False
