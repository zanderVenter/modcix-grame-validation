"""YAML loading with ${VAR} environment-variable substitution.

Lets config/catalog.yaml reference config/.env values (e.g. ${GEEPROJECT})
without ever storing the real values in a committed file.
Adapted from https://github.com/geopython/pygeoapi/blob/master/pygeoapi/util.py
"""

import os
import re
from typing import IO, Union

import yaml


def get_typed_value(value: str) -> Union[float, int, str]:
    """Cast a string to float/int where possible, else leave as str."""
    try:
        if "." in value:
            return float(value)
        if len(value) > 1 and value.startswith("0"):
            return value
        return int(value)
    except ValueError:
        return value


def yaml_load(fh: IO) -> dict:
    """Load YAML, resolving ${ENV_VAR} references against os.environ."""
    path_matcher = re.compile(r".*\$\{([^}^{]+)\}.*")

    def path_constructor(loader, node):
        env_var = path_matcher.match(node.value).group(1)
        if env_var not in os.environ:
            raise EnvironmentError(f"Undefined environment variable {env_var} in config")
        return get_typed_value(os.path.expandvars(node.value))

    class EnvVarLoader(yaml.SafeLoader):
        pass

    EnvVarLoader.add_implicit_resolver("!path", path_matcher, None)
    EnvVarLoader.add_constructor("!path", path_constructor)

    return yaml.load(fh, Loader=EnvVarLoader)
