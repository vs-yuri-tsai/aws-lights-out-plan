"""
Unit tests for handlers/base.py

Tests the abstract ResourceHandler base class interface.
Following TDD approach - these tests define the expected behavior.
"""

import pytest
from src.lambda_function.discovery.base import DiscoveredResource
from src.lambda_function.handlers.base import ResourceHandler, HandlerResult


# Test Fixtures
@pytest.fixture
def sample_resource():
    """Sample DiscoveredResource for testing"""
    return DiscoveredResource(
        resource_type="ecs-service",
        arn="arn:aws:ecs:ap-southeast-1:123456789012:service/test-cluster/test-service",
        resource_id="test-cluster/test-service",
        priority=50,
        group="default",
        tags={
            "lights-out:managed": "true",
            "lights-out:env": "workshop"
        },
        metadata={"cluster_name": "test-cluster"}
    )


@pytest.fixture
def sample_config():
    """Sample configuration from SSM"""
    return {
        "version": "1.0",
        "environment": "workshop",
        "resource_defaults": {
            "ecs-service": {
                "wait_for_stable": True,
                "stable_timeout_seconds": 300,
                "default_desired_count": 1
            }
        }
    }


# Test: Abstract Class
def test_resource_handler_is_abstract(sample_resource, sample_config):
    """
    ResourceHandler cannot be instantiated directly as it is an abstract class.
    """
    with pytest.raises(TypeError, match="Can't instantiate abstract class ResourceHandler"):
        ResourceHandler(resource=sample_resource, config=sample_config)


# Test: Subclass Must Implement All Abstract Methods
def test_subclass_must_implement_all_abstract_methods(sample_resource, sample_config):
    """
    Subclass must implement get_status, start, stop, and is_ready methods.
    """
    with pytest.raises(TypeError, match="Can't instantiate abstract class"):
        class IncompleteHandler(ResourceHandler):
            """Missing all abstract methods"""
            pass

        IncompleteHandler(resource=sample_resource, config=sample_config)


def test_subclass_missing_get_status(sample_resource, sample_config):
    """Subclass missing get_status should not instantiate"""
    with pytest.raises(TypeError):
        class PartialHandler(ResourceHandler):
            def start(self):
                return HandlerResult(
                    success=True,
                    action="start",
                    resource_type=self.resource.resource_type,
                    resource_id=self.resource.resource_id,
                    message="Started"
                )

            def stop(self):
                return HandlerResult(
                    success=True,
                    action="stop",
                    resource_type=self.resource.resource_type,
                    resource_id=self.resource.resource_id,
                    message="Stopped"
                )

            def is_ready(self):
                return True

        PartialHandler(resource=sample_resource, config=sample_config)


# Test: Concrete Handler Implementation
def test_concrete_handler_can_be_instantiated(sample_resource, sample_config):
    """
    A complete concrete handler implementing all abstract methods can be instantiated.
    """
    class ConcreteHandler(ResourceHandler):
        def get_status(self):
            return {
                "desired_count": 1,
                "running_count": 1,
                "status": "ACTIVE"
            }

        def start(self):
            return HandlerResult(
                success=True,
                action="start",
                resource_type=self.resource.resource_type,
                resource_id=self.resource.resource_id,
                message="Started successfully"
            )

        def stop(self):
            return HandlerResult(
                success=True,
                action="stop",
                resource_type=self.resource.resource_type,
                resource_id=self.resource.resource_id,
                message="Stopped successfully"
            )

        def is_ready(self):
            return True

    handler = ConcreteHandler(resource=sample_resource, config=sample_config)

    # Verify initialization
    assert handler.resource == sample_resource
    assert handler.config == sample_config
    assert handler.logger is not None


# Test: Handler Methods Return Expected Types
def test_handler_methods_return_correct_types(sample_resource, sample_config):
    """
    Verify that handler methods return the expected types.
    """
    class TestHandler(ResourceHandler):
        def get_status(self):
            return {"status": "ACTIVE"}

        def start(self):
            return HandlerResult(
                success=True,
                action="start",
                resource_type=self.resource.resource_type,
                resource_id=self.resource.resource_id,
                message="Started"
            )

        def stop(self):
            return HandlerResult(
                success=True,
                action="stop",
                resource_type=self.resource.resource_type,
                resource_id=self.resource.resource_id,
                message="Stopped"
            )

        def is_ready(self):
            return True

    handler = TestHandler(resource=sample_resource, config=sample_config)

    # Test get_status returns dict
    status = handler.get_status()
    assert isinstance(status, dict)
    assert "status" in status

    # Test start returns HandlerResult
    start_result = handler.start()
    assert isinstance(start_result, HandlerResult)
    assert start_result.success is True
    assert start_result.action == "start"

    # Test stop returns HandlerResult
    stop_result = handler.stop()
    assert isinstance(stop_result, HandlerResult)
    assert stop_result.success is True
    assert stop_result.action == "stop"

    # Test is_ready returns bool
    ready = handler.is_ready()
    assert isinstance(ready, bool)


# Test: HandlerResult Dataclass
def test_handler_result_structure():
    """
    Test that HandlerResult dataclass has the expected structure.
    """
    result = HandlerResult(
        success=True,
        action="start",
        resource_type="ecs-service",
        resource_id="test-cluster/test-service",
        message="Operation successful",
        previous_state={"desired_count": 0},
        error=None
    )

    assert result.success is True
    assert result.action == "start"
    assert result.resource_type == "ecs-service"
    assert result.resource_id == "test-cluster/test-service"
    assert result.message == "Operation successful"
    assert result.previous_state == {"desired_count": 0}
    assert result.error is None


def test_handler_result_with_error():
    """
    Test HandlerResult with error information.
    """
    result = HandlerResult(
        success=False,
        action="stop",
        resource_type="ecs-service",
        resource_id="test-cluster/test-service",
        message="Operation failed",
        error="Service not found"
    )

    assert result.success is False
    assert result.error == "Service not found"
    assert result.previous_state is None  # Optional field


# Test: _get_resource_defaults Helper
def test_get_resource_defaults_method(sample_resource, sample_config):
    """
    Test that _get_resource_defaults correctly extracts defaults from config.
    """
    class TestHandler(ResourceHandler):
        def get_status(self):
            return {}

        def start(self):
            pass

        def stop(self):
            pass

        def is_ready(self):
            return True

    handler = TestHandler(resource=sample_resource, config=sample_config)
    defaults = handler._get_resource_defaults()

    assert defaults == {
        "wait_for_stable": True,
        "stable_timeout_seconds": 300,
        "default_desired_count": 1
    }


def test_get_resource_defaults_missing_config(sample_resource):
    """
    Test _get_resource_defaults when resource type is not in config.
    """
    class TestHandler(ResourceHandler):
        def get_status(self):
            return {}

        def start(self):
            pass

        def stop(self):
            pass

        def is_ready(self):
            return True

    config = {"version": "1.0"}  # No resource_defaults
    handler = TestHandler(resource=sample_resource, config=config)
    defaults = handler._get_resource_defaults()

    assert defaults == {}


# Test: Logger Integration
def test_handler_has_logger(sample_resource, sample_config):
    """
    Test that handler initializes with a logger.
    """
    class TestHandler(ResourceHandler):
        def get_status(self):
            return {}

        def start(self):
            pass

        def stop(self):
            pass

        def is_ready(self):
            return True

    handler = TestHandler(resource=sample_resource, config=sample_config)

    # Verify logger is initialized
    assert handler.logger is not None
    # Logger name should include resource type
    assert "ecs-service" in handler.logger._logger.name
