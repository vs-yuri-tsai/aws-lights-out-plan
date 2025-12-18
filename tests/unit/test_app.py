"""
Unit tests for app.py (Lambda handler entry point).

Tests the Lambda handler function using TDD approach.

Note: All context objects must have aws_request_id and function_name
      set explicitly to avoid JSON serialization errors with MagicMock.
      Consider using tests.helpers.create_mock_lambda_context() for
      more complex tests.
"""

import pytest
from unittest.mock import patch, MagicMock
import json


@pytest.fixture
def mock_ssm_config():
    """Mock configuration from SSM"""
    return {
        "version": "1.0",
        "environment": "workshop",
        "discovery": {
            "method": "tags",
            "tag_filters": {
                "lights-out:managed": "true",
                "lights-out:env": "workshop"
            }
        },
        "settings": {
            "schedule_tag": "lights-out:schedule"
        },
        "resource_defaults": {
            "ecs-service": {
                "wait_for_stable": False,
                "default_desired_count": 1
            }
        }
    }


@pytest.fixture
def mock_orchestrator_result():
    """Mock orchestrator result"""
    return {
        "total": 5,
        "succeeded": 4,
        "failed": 1,
        "results": [
            {"success": True, "resource_id": "service-1"},
            {"success": True, "resource_id": "service-2"},
            {"success": True, "resource_id": "service-3"},
            {"success": True, "resource_id": "service-4"},
            {"success": False, "resource_id": "service-5", "error": "API error"}
        ]
    }


class TestLambdaHandler:
    """Tests for the main Lambda handler function"""

    @patch('src.lambda_function.app.Orchestrator')
    @patch('src.lambda_function.app.load_config_from_ssm')
    def test_handler_with_stop_action(
        self,
        mock_load_config,
        mock_orchestrator_class,
        mock_ssm_config,
        mock_orchestrator_result
    ):
        """
        Test handler with 'stop' action executes successfully
        """
        # Arrange
        from src.lambda_function.app import handler

        mock_load_config.return_value = mock_ssm_config
        mock_orchestrator_instance = MagicMock()
        mock_orchestrator_instance.run.return_value = mock_orchestrator_result
        mock_orchestrator_class.return_value = mock_orchestrator_instance

        event = {"action": "stop"}
        context = MagicMock()

        # Act
        response = handler(event, context)

        # Assert
        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body["action"] == "stop"
        assert body["total"] == 5
        assert body["succeeded"] == 4
        assert body["failed"] == 1

        mock_load_config.assert_called_once()
        mock_orchestrator_instance.run.assert_called_once_with(action="stop")

    @patch('src.lambda_function.app.Orchestrator')
    @patch('src.lambda_function.app.load_config_from_ssm')
    def test_handler_with_start_action(
        self,
        mock_load_config,
        mock_orchestrator_class,
        mock_ssm_config,
        mock_orchestrator_result
    ):
        """
        Test handler with 'start' action executes successfully
        """
        # Arrange
        from src.lambda_function.app import handler

        mock_load_config.return_value = mock_ssm_config
        mock_orchestrator_instance = MagicMock()
        mock_orchestrator_instance.run.return_value = mock_orchestrator_result
        mock_orchestrator_class.return_value = mock_orchestrator_instance

        event = {"action": "start"}
        context = MagicMock()

        # Act
        response = handler(event, context)

        # Assert
        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body["action"] == "start"

        mock_orchestrator_instance.run.assert_called_once_with(action="start")

    @patch('src.lambda_function.app.Orchestrator')
    @patch('src.lambda_function.app.load_config_from_ssm')
    def test_handler_with_status_action(
        self,
        mock_load_config,
        mock_orchestrator_class,
        mock_ssm_config
    ):
        """
        Test handler with 'status' action executes successfully
        """
        # Arrange
        from src.lambda_function.app import handler

        mock_load_config.return_value = mock_ssm_config
        mock_orchestrator_instance = MagicMock()
        mock_orchestrator_instance.run.return_value = {
            "total": 3,
            "succeeded": 3,
            "failed": 0,
            "results": []
        }
        mock_orchestrator_class.return_value = mock_orchestrator_instance

        event = {"action": "status"}
        context = MagicMock()

        # Act
        response = handler(event, context)

        # Assert
        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body["action"] == "status"

        mock_orchestrator_instance.run.assert_called_once_with(action="status")

    @patch('src.lambda_function.app.Orchestrator')
    @patch('src.lambda_function.app.load_config_from_ssm')
    def test_handler_with_discover_action(
        self,
        mock_load_config,
        mock_orchestrator_class,
        mock_ssm_config
    ):
        """
        Test handler with 'discover' action returns discovered resources
        """
        # Arrange
        from src.lambda_function.app import handler

        mock_load_config.return_value = mock_ssm_config
        mock_orchestrator_instance = MagicMock()
        mock_orchestrator_instance.discover_resources.return_value = [
            MagicMock(resource_id="service-1", resource_type="ecs-service"),
            MagicMock(resource_id="service-2", resource_type="ecs-service"),
        ]
        mock_orchestrator_class.return_value = mock_orchestrator_instance

        event = {"action": "discover"}
        context = MagicMock()

        # Act
        response = handler(event, context)

        # Assert
        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body["action"] == "discover"
        assert body["discovered_count"] == 2

        mock_orchestrator_instance.discover_resources.assert_called_once()

    @patch('src.lambda_function.app.load_config_from_ssm')
    def test_handler_without_action_defaults_to_status(
        self,
        mock_load_config,
        mock_ssm_config
    ):
        """
        Test handler without action parameter defaults to 'status'
        """
        # Arrange
        from src.lambda_function.app import handler

        mock_load_config.return_value = mock_ssm_config

        event = {}  # No action specified
        context = MagicMock()
        context.aws_request_id = "test-request-123"
        context.function_name = "test-function"

        # Act
        with patch('src.lambda_function.app.Orchestrator') as mock_orch_class:
            mock_orch_instance = MagicMock()
            mock_orch_instance.run.return_value = {"total": 0, "succeeded": 0, "failed": 0, "results": []}
            mock_orch_class.return_value = mock_orch_instance

            response = handler(event, context)

        # Assert
        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body["action"] == "status"

    @patch('src.lambda_function.app.load_config_from_ssm')
    def test_handler_with_invalid_action_returns_error(
        self,
        mock_load_config,
        mock_ssm_config
    ):
        """
        Test handler with invalid action returns error response
        """
        # Arrange
        from src.lambda_function.app import handler

        mock_load_config.return_value = mock_ssm_config

        event = {"action": "invalid_action"}
        context = MagicMock()
        context.aws_request_id = "test-request-123"
        context.function_name = "test-function"

        # Act
        response = handler(event, context)

        # Assert
        assert response["statusCode"] == 400
        body = json.loads(response["body"])
        assert "error" in body
        assert "invalid_action" in body["error"]

    @patch('src.lambda_function.app.load_config_from_ssm')
    def test_handler_with_config_load_failure(
        self,
        mock_load_config
    ):
        """
        Test handler handles SSM config load failure gracefully
        """
        # Arrange
        from src.lambda_function.app import handler

        mock_load_config.side_effect = Exception("SSM parameter not found")

        event = {"action": "stop"}
        context = MagicMock()
        context.aws_request_id = "test-request-123"
        context.function_name = "test-function"

        # Act
        response = handler(event, context)

        # Assert
        assert response["statusCode"] == 500
        body = json.loads(response["body"])
        assert "error" in body
        assert "SSM parameter not found" in body["error"]

    @patch('src.lambda_function.app.Orchestrator')
    @patch('src.lambda_function.app.load_config_from_ssm')
    def test_handler_with_orchestrator_failure(
        self,
        mock_load_config,
        mock_orchestrator_class,
        mock_ssm_config
    ):
        """
        Test handler handles orchestrator execution failure
        """
        # Arrange
        from src.lambda_function.app import handler

        mock_load_config.return_value = mock_ssm_config
        mock_orchestrator_instance = MagicMock()
        mock_orchestrator_instance.run.side_effect = Exception("Orchestrator error")
        mock_orchestrator_class.return_value = mock_orchestrator_instance

        event = {"action": "stop"}
        context = MagicMock()
        context.aws_request_id = "test-request-123"
        context.function_name = "test-function"

        # Act
        response = handler(event, context)

        # Assert
        assert response["statusCode"] == 500
        body = json.loads(response["body"])
        assert "error" in body
        assert "Orchestrator error" in body["error"]

    @patch('src.lambda_function.app.Orchestrator')
    @patch('src.lambda_function.app.load_config_from_ssm')
    def test_handler_uses_custom_ssm_parameter_name(
        self,
        mock_load_config,
        mock_orchestrator_class,
        mock_ssm_config
    ):
        """
        Test handler uses custom SSM parameter name from environment variable
        """
        # Arrange
        from src.lambda_function.app import handler

        mock_load_config.return_value = mock_ssm_config
        mock_orchestrator_instance = MagicMock()
        mock_orchestrator_instance.run.return_value = {"total": 0, "succeeded": 0, "failed": 0, "results": []}
        mock_orchestrator_class.return_value = mock_orchestrator_instance

        event = {"action": "stop"}
        context = MagicMock()

        # Act
        with patch.dict('os.environ', {'CONFIG_PARAMETER_NAME': '/custom/config/path'}):
            response = handler(event, context)

        # Assert
        mock_load_config.assert_called_once_with('/custom/config/path')

    @patch('src.lambda_function.app.Orchestrator')
    @patch('src.lambda_function.app.load_config_from_ssm')
    def test_handler_response_includes_metadata(
        self,
        mock_load_config,
        mock_orchestrator_class,
        mock_ssm_config,
        mock_orchestrator_result
    ):
        """
        Test handler response includes execution metadata
        """
        # Arrange
        from src.lambda_function.app import handler

        mock_load_config.return_value = mock_ssm_config
        mock_orchestrator_instance = MagicMock()
        mock_orchestrator_instance.run.return_value = mock_orchestrator_result
        mock_orchestrator_class.return_value = mock_orchestrator_instance

        event = {"action": "stop"}
        context = MagicMock()
        context.function_name = "lights-out-scheduler"
        context.aws_request_id = "test-request-id-123"

        # Act
        response = handler(event, context)

        # Assert
        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert "timestamp" in body
        assert "request_id" in body
        assert body["request_id"] == "test-request-id-123"
