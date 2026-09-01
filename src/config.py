"""Project configuration loader.

Reads config/.env (git-ignored, created from config/template.env) and resolves
it into config/catalog.yaml (committed, contains only ${VAR} placeholders).
"""

import os
from pathlib import Path

from dotenv import load_dotenv

from src.utils import yaml_load

project_root = Path(__file__).parents[1]
load_dotenv(os.path.join(project_root, "config/.env"))


def load_catalog() -> dict:
    with open(os.path.join(project_root, "config/catalog.yaml"), "r") as f:
        return yaml_load(f)
