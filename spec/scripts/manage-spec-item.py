#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "PyYAML>=6.0,<7",
# ]
# ///
"""Manage repository-local spec work items through completed and superseded archival."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import tempfile
import unicodedata
from pathlib import Path
from typing import Any

import yaml

SCHEMA_VERSION = 2
SUPPORTED_ARCHIVE_SCHEMAS = {1, 2}
ROUTES = {"quick-plan", "grill-to-spec"}
KINDS = {"initiative", "work-item"}
WORK_TYPES = {
    "feature",
    "bug",
    "refactor",
    "research",
    "migration",
    "operations",
    "documentation",
    "other",
}
ACTIVE_STATUSES = {"discovering", "revision_required", "ready_for_spec", "planned"}
TERMINAL_STATUSES = {"completed", "superseded"}
STATUSES = ACTIVE_STATUSES | TERMINAL_STATUSES
REPLACEMENT_STATUSES = ACTIVE_STATUSES | {"completed"}
TRANSITIONS = {
    "discovering": {"ready_for_spec"},
    "revision_required": {"ready_for_spec"},
    "ready_for_spec": {"planned", "revision_required"},
    "planned": {"revision_required"},
}
ACTIVE_START = "<!-- spec-items:active:start -->"
ACTIVE_END = "<!-- spec-items:active:end -->"
ARCHIVE_START = "<!-- spec-items:archive:start -->"
ARCHIVE_END = "<!-- spec-items:archive:end -->"
ID_PATTERN = re.compile(r"^[0-9]{6}-[0-9]{4}-[a-z0-9]+(?:-[a-z0-9]+)*(?:-[0-9]+)?$")
REFINEMENT_PATTERN = re.compile(r"^R([0-9]{3})\.md$")
MARKDOWN_SUFFIXES = {".md", ".markdown"}
DREAM_EPISODE_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}-\d{4}-[a-z0-9][a-z0-9-]*\.md$"
)


class ProtocolError(Exception):
    """A user-correctable protocol error with a stable process exit code."""

    def __init__(self, message: str, code: int = 5) -> None:
        super().__init__(message)
        self.code = code


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=True, sort_keys=True))


def now_iso() -> str:
    return dt.datetime.now().astimezone().replace(microsecond=0).isoformat()


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", normalized.lower()).strip("-")
    slug = re.sub(r"-+", "-", slug)
    return slug[:80] or "work-item"


def protocol_paths(root: Path) -> dict[str, Path]:
    spec = root / "spec"
    return {
        "root": root,
        "spec": spec,
        "active": spec / "active",
        "archive": spec / "archive",
        "templates": spec / "templates",
        "index": spec / "index.md",
    }


def require_protocol(paths: dict[str, Path]) -> None:
    required_files = [
        paths["spec"] / "AGENTS.md",
        paths["templates"] / "item.yaml",
        paths["templates"] / "discovery.md",
        paths["templates"] / "plan.md",
        paths["templates"] / "refinement.md",
        paths["templates"] / "verification.md",
        paths["templates"] / "outcome.md",
        paths["index"],
    ]
    required_directories = [paths["active"], paths["archive"]]
    invalid = [path for path in required_files if not path.is_file()]
    invalid.extend(path for path in required_directories if not path.is_dir())
    if invalid:
        relative = sorted(str(path.relative_to(paths["root"])) for path in invalid)
        raise ProtocolError(
            "required spec protocol paths are missing or have the wrong type: "
            + ", ".join(relative),
            code=3,
        )


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent), text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def load_manifest(item_dir: Path) -> dict[str, Any]:
    manifest_path = item_dir / "item.yaml"
    if not manifest_path.is_file():
        raise ProtocolError(f"item manifest not found: {manifest_path}", code=3)
    try:
        data = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise ProtocolError(f"cannot read {manifest_path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ProtocolError(f"manifest must contain a YAML mapping: {manifest_path}")
    return data


def write_manifest(item_dir: Path, manifest: dict[str, Any]) -> None:
    content = yaml.safe_dump(
        manifest,
        allow_unicode=False,
        default_flow_style=False,
        sort_keys=False,
    )
    atomic_write(item_dir / "item.yaml", content)


def validate_manifest_shape(item_dir: Path, manifest: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    required = {
        "schema_version",
        "id",
        "title",
        "kind",
        "work_type",
        "parent",
        "route",
        "status",
        "superseded_by",
        "created_at",
        "updated_at",
        "external_refs",
        "wiki_refs",
    }
    missing = sorted(required - manifest.keys())
    if missing:
        errors.append("missing fields: " + ", ".join(missing))

    item_id = manifest.get("id")
    if item_id != item_dir.name:
        errors.append(f"manifest id {item_id!r} does not match directory {item_dir.name!r}")
    if not isinstance(item_id, str) or not ID_PATTERN.fullmatch(item_id):
        errors.append("id must match YYMMDD-HHMM-kebab-slug")
    if manifest.get("schema_version") != SCHEMA_VERSION:
        errors.append(f"schema_version must equal {SCHEMA_VERSION}")
    if not isinstance(manifest.get("title"), str) or not manifest.get("title", "").strip():
        errors.append("title must be a non-empty string")
    if manifest.get("kind") not in KINDS:
        errors.append("kind must be one of: " + ", ".join(sorted(KINDS)))
    work_type = manifest.get("work_type")
    if manifest.get("kind") == "work-item" and work_type not in WORK_TYPES:
        errors.append("work_type must be one of: " + ", ".join(sorted(WORK_TYPES)))
    if manifest.get("kind") == "initiative" and work_type not in {None, "other"}:
        errors.append("initiative work_type must be null or other")
    parent = manifest.get("parent")
    if parent is not None and (not isinstance(parent, str) or not parent.strip()):
        errors.append("parent must be null or a non-empty item ID")
    if parent == item_id:
        errors.append("an item cannot be its own parent")
    route = manifest.get("route")
    status = manifest.get("status")
    superseded_by = manifest.get("superseded_by")
    if route not in ROUTES:
        errors.append("route must be one of: " + ", ".join(sorted(ROUTES)))
    if status not in STATUSES:
        errors.append("status must be one of: " + ", ".join(sorted(STATUSES)))
    if route == "quick-plan" and status not in {
        "revision_required",
        "ready_for_spec",
        "planned",
        "completed",
        "superseded",
    }:
        errors.append(
            "quick-plan items must have status revision_required, ready_for_spec, planned, completed, or superseded"
        )
    if route == "grill-to-spec" and status not in STATUSES:
        errors.append("grill-to-spec items must use a supported lifecycle status")
    if status == "superseded":
        if not isinstance(superseded_by, str) or not superseded_by.strip():
            errors.append("superseded_by must be a non-empty item ID when status is superseded")
        elif not ID_PATTERN.fullmatch(superseded_by):
            errors.append("superseded_by must match YYMMDD-HHMM-kebab-slug")
        elif superseded_by == item_id:
            errors.append("an item cannot supersede itself")
    elif "superseded_by" in manifest and superseded_by is not None:
        errors.append("superseded_by must be null unless status is superseded")
    for field in ("created_at", "updated_at"):
        value = manifest.get(field)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"{field} must be a non-empty ISO 8601 string")
            continue
        try:
            parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            errors.append(f"{field} must be a parseable ISO 8601 timestamp")
            continue
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            errors.append(f"{field} must include a timezone offset")
    external_refs = manifest.get("external_refs")
    if not isinstance(external_refs, list):
        errors.append("external_refs must be a list")
    else:
        required_ref_fields = {"system", "type", "key"}
        allowed_ref_fields = required_ref_fields | {"url"}
        for index, reference in enumerate(external_refs):
            if not isinstance(reference, dict):
                errors.append(f"external_refs[{index}] must be a mapping")
                continue
            missing_ref_fields = sorted(required_ref_fields - reference.keys())
            unknown_ref_fields = sorted(
                str(field) for field in reference.keys() if field not in allowed_ref_fields
            )
            if missing_ref_fields:
                errors.append(
                    f"external_refs[{index}] missing fields: {', '.join(missing_ref_fields)}"
                )
            if unknown_ref_fields:
                errors.append(
                    f"external_refs[{index}] has unknown fields: {', '.join(unknown_ref_fields)}"
                )
            for field in required_ref_fields:
                if field in reference and (
                    not isinstance(reference[field], str) or not reference[field].strip()
                ):
                    errors.append(f"external_refs[{index}].{field} must be a non-empty string")
            if "url" in reference and (
                not isinstance(reference["url"], str) or not reference["url"].strip()
            ):
                errors.append(f"external_refs[{index}].url must be a non-empty string")
    if not isinstance(manifest.get("wiki_refs"), list) or not all(
        isinstance(value, str) and value.strip() for value in manifest.get("wiki_refs", [])
    ):
        errors.append("wiki_refs must be a list of non-empty strings")
    return errors


def item_location(item_dir: Path, paths: dict[str, Path]) -> str | None:
    resolved = item_dir.resolve()
    for location in ("active", "archive"):
        if resolved.parent == paths[location].resolve():
            return location
    return None


def validate_schema_1_archive_shape(item_dir: Path, manifest: dict[str, Any]) -> list[str]:
    """Validate the complete pre-supersession manifest contract without upgrading it."""
    candidate = dict(manifest)
    candidate["schema_version"] = SCHEMA_VERSION
    candidate["superseded_by"] = None
    errors = validate_manifest_shape(item_dir, candidate)
    if manifest.get("schema_version") != 1:
        errors.append("schema_version must equal 1")
    if "superseded_by" in manifest:
        errors.append("schema 1 archives must not define superseded_by")
    if manifest.get("status") != "completed":
        errors.append("schema 1 archives must have status completed")
    return errors


def route_artifact(item_dir: Path, route: Any, status: Any) -> tuple[str | None, list[str]]:
    errors: list[str] = []
    target: str | None = None
    if route == "quick-plan":
        target = "plan.md"
    elif route == "grill-to-spec":
        if status in {"planned", "completed"} or (item_dir / "plan.md").is_file():
            target = "plan.md"
        else:
            target = "discovery.md"
    if target:
        path = item_dir / target
        if not path.is_file() or path.is_symlink():
            errors.append(f"index route target must be regular non-symlink {target}")
    return target, errors


def validate_archive_operational(
    item_dir: Path,
    paths: dict[str, Path],
    allow_archive_statuses: set[str] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """Return the immutable archive's live envelope and non-blocking audit defects."""
    manifest = load_manifest(item_dir)
    schema = manifest.get("schema_version")
    if type(schema) is not int or schema not in SUPPORTED_ARCHIVE_SCHEMAS:
        raise ProtocolError(
            f"invalid item {item_dir.name}: unsupported archive schema_version {schema!r}"
        )

    required = {"schema_version", "id", "title", "kind", "parent", "route", "status", "updated_at"}
    if schema == 2:
        required.add("superseded_by")
    errors = []
    missing = sorted(required - manifest.keys())
    if missing:
        errors.append("missing operational fields: " + ", ".join(missing))

    item_id = manifest.get("id")
    if item_id != item_dir.name:
        errors.append(f"manifest id {item_id!r} does not match directory {item_dir.name!r}")
    if not isinstance(item_id, str) or not ID_PATTERN.fullmatch(item_id):
        errors.append("id must match YYMMDD-HHMM-kebab-slug")
    if not isinstance(manifest.get("title"), str) or not manifest.get("title", "").strip():
        errors.append("title must be a non-empty string")
    if manifest.get("kind") not in KINDS:
        errors.append("kind must be one of: " + ", ".join(sorted(KINDS)))
    parent = manifest.get("parent")
    if parent is not None and (
        not isinstance(parent, str) or not ID_PATTERN.fullmatch(parent)
    ):
        errors.append("parent must be null or a valid item ID")
    if parent == item_id:
        errors.append("an item cannot be its own parent")
    route = manifest.get("route")
    if route not in ROUTES:
        errors.append("route must be one of: " + ", ".join(sorted(ROUTES)))
    status = manifest.get("status")
    allowed_statuses = TERMINAL_STATUSES | (allow_archive_statuses or set())
    if schema == 1 and status != "completed":
        errors.append("schema 1 archives must have status completed")
    elif schema == 2 and status not in allowed_statuses:
        errors.append("archived items must have status completed or superseded")
    replacement = manifest.get("superseded_by") if schema == 2 else None
    if schema == 2:
        if status == "superseded":
            if not isinstance(replacement, str) or not ID_PATTERN.fullmatch(replacement):
                errors.append("superseded_by must be a valid item ID when status is superseded")
            elif replacement == item_id:
                errors.append("an item cannot supersede itself")
        elif replacement is not None:
            errors.append("superseded_by must be null unless status is superseded")
    updated = manifest.get("updated_at")
    if not isinstance(updated, str) or not updated.strip():
        errors.append("updated_at must be a non-empty ISO 8601 string")
    else:
        try:
            parsed = dt.datetime.fromisoformat(updated.replace("Z", "+00:00"))
            if parsed.tzinfo is None or parsed.utcoffset() is None:
                errors.append("updated_at must include a timezone offset")
        except ValueError:
            errors.append("updated_at must be a parseable ISO 8601 timestamp")
    target, target_errors = route_artifact(item_dir, route, status)
    errors.extend(target_errors)
    if item_location(item_dir, paths) != "archive":
        errors.append("archive record must be located under spec/archive")
    if errors:
        raise ProtocolError(f"invalid item {item_dir.name}: " + "; ".join(errors))

    full_errors = (
        validate_schema_1_archive_shape(item_dir, manifest)
        if schema == 1
        else validate_manifest_shape(item_dir, manifest)
    )
    if route == "grill-to-spec":
        discovery = item_dir / "discovery.md"
        if not discovery.is_file() or discovery.is_symlink():
            full_errors.append("grill-to-spec items require regular non-symlink discovery.md")
    if status == "completed":
        for artifact in ("plan.md", "verification.md", "outcome.md"):
            artifact_path = item_dir / artifact
            if not artifact_path.is_file() or artifact_path.is_symlink():
                full_errors.append(f"completed items require regular non-symlink {artifact}")
    if status == "superseded":
        outcome = item_dir / "outcome.md"
        if not outcome.is_file() or outcome.is_symlink():
            full_errors.append("superseded items require regular non-symlink outcome.md")

    record = {
        "schema_version": schema,
        "id": item_id,
        "title": manifest["title"],
        "kind": manifest["kind"],
        "route": route,
        "status": status,
        "updated_at": updated,
        "parent": parent,
        "superseded_by": replacement,
        "route_artifact": target,
    }
    return record, full_errors


def refinement_dossiers(item_dir: Path) -> tuple[list[Path], list[str]]:
    """Return canonical sequential dossiers without interpreting their Markdown."""
    directory = item_dir / "refinements"
    if not directory.exists():
        return [], []
    if not directory.is_dir() or directory.is_symlink():
        return [], ["refinements must be a regular non-symlink directory"]

    dossiers: list[tuple[int, Path]] = []
    errors: list[str] = []
    for path in sorted(directory.iterdir(), key=lambda candidate: candidate.name):
        match = REFINEMENT_PATTERN.fullmatch(path.name)
        if not match:
            errors.append(f"invalid refinement dossier name: refinements/{path.name}")
            continue
        number = int(match.group(1))
        if number == 0:
            errors.append("refinement dossier numbering starts at R001")
        if not path.is_file() or path.is_symlink():
            errors.append(
                f"refinement dossier must be a regular non-symlink file: refinements/{path.name}"
            )
            continue
        dossiers.append((number, path))

    numbers = [number for number, _ in dossiers if number > 0]
    if numbers and numbers != list(range(1, max(numbers) + 1)):
        errors.append("refinement dossiers must be sequential from R001 without gaps")
    return [path for number, path in dossiers if number > 0], errors


def validate_item(
    item_dir: Path,
    paths: dict[str, Path],
    allow_archive_statuses: set[str] | None = None,
) -> dict[str, Any]:
    location = item_location(item_dir, paths)
    if location == "archive":
        record, full_errors = validate_archive_operational(
            item_dir, paths, allow_archive_statuses=allow_archive_statuses
        )
        if full_errors:
            raise ProtocolError(f"invalid item {item_dir.name}: " + "; ".join(full_errors))
        return load_manifest(item_dir)

    manifest = load_manifest(item_dir)
    errors = validate_manifest_shape(item_dir, manifest)
    route = manifest.get("route")
    status = manifest.get("status")
    if location == "active" and status not in ACTIVE_STATUSES:
        errors.append("active items must use a nonterminal planning status")
    if location is None:
        errors.append("item must be located under spec/active or spec/archive")
    dossiers, dossier_errors = refinement_dossiers(item_dir)
    errors.extend(dossier_errors)
    plan = item_dir / "plan.md"
    if route == "quick-plan" and not plan.is_file():
        errors.append("quick-plan items require plan.md")
    if route == "grill-to-spec" and not (item_dir / "discovery.md").is_file():
        errors.append("grill-to-spec items require discovery.md")
    if status == "revision_required" and (not plan.is_file() or plan.is_symlink()):
        errors.append("revision_required items require regular non-symlink plan.md")
    if status == "ready_for_spec" and route == "quick-plan" and not dossiers:
        errors.append("revision ready_for_spec requires a valid current refinements/Rxxx.md")
    if status == "ready_for_spec" and dossiers and (not plan.is_file() or plan.is_symlink()):
        errors.append("revision ready_for_spec requires regular non-symlink plan.md")
    if route == "grill-to-spec" and status == "planned" and not plan.is_file():
        errors.append("planned grill-to-spec items require plan.md")
    if errors:
        raise ProtocolError(f"invalid item {item_dir.name}: " + "; ".join(errors))
    return manifest


def render_template(template_path: Path, values: dict[str, str]) -> str:
    content = template_path.read_text(encoding="utf-8")
    for key, value in values.items():
        content = content.replace("{{" + key + "}}", value)
    return content


def parse_external_ref(value: str) -> dict[str, str]:
    parts = value.split(":", 3)
    if len(parts) < 3 or not all(part.strip() for part in parts[:3]):
        raise argparse.ArgumentTypeError(
            "external refs use SYSTEM:TYPE:KEY or SYSTEM:TYPE:KEY:URL"
        )
    result = {"system": parts[0], "type": parts[1], "key": parts[2]}
    if len(parts) == 4 and parts[3]:
        result["url"] = parts[3]
    return result


def item_id_exists(paths: dict[str, Path], candidate: str) -> bool:
    return any((paths[location] / candidate).exists() for location in ("active", "archive"))


def unique_item_id(paths: dict[str, Path], title: str, requested: str | None) -> str:
    if requested:
        candidate = requested
        if not ID_PATTERN.fullmatch(candidate):
            raise ProtocolError("--id must match YYMMDD-HHMM-kebab-slug")
        if item_id_exists(paths, candidate):
            raise ProtocolError(f"work item already exists: {candidate}")
        return candidate

    prefix = dt.datetime.now().strftime("%y%m%d-%H%M")
    base = f"{prefix}-{slugify(title)}"
    candidate = base
    suffix = 2
    while item_id_exists(paths, candidate):
        candidate = f"{base}-{suffix}"
        suffix += 1
    return candidate


def replace_region(text: str, start: str, end: str, body: str) -> str:
    if text.count(start) != 1 or text.count(end) != 1:
        raise ProtocolError(f"spec/index.md must contain exactly one {start!r} and {end!r}")
    start_index = text.index(start) + len(start)
    end_index = text.index(end)
    if start_index > end_index:
        raise ProtocolError(f"managed index markers are out of order: {start!r}")
    return text[:start_index] + "\n" + body.rstrip() + "\n" + text[end_index:]


def normalized_active(item_dir: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    target, errors = route_artifact(item_dir, manifest.get("route"), manifest.get("status"))
    if errors:
        raise ProtocolError(f"invalid item {item_dir.name}: " + "; ".join(errors))
    record = dict(manifest)
    record["route_artifact"] = target
    return record


def table_for(items: list[tuple[Path, dict[str, Any]]], location: str) -> str:
    lines = [
        "| Item | Kind | Status | Updated |",
        "| --- | --- | --- | --- |",
    ]
    for item_dir, record in sorted(items, key=lambda entry: entry[0].name):
        title = str(record["title"]).replace("|", "\\|")
        updated = str(record["updated_at"]).split("T", 1)[0]
        lines.append(
            f"| [{title}](./{location}/{item_dir.name}/{record['route_artifact']}) | "
            f"{record['kind']} | {record['status']} | {updated} |"
        )
    return "\n".join(lines)


def item_directories(directory: Path, require_manifests: bool) -> list[Path]:
    if not directory.is_dir():
        return []
    item_dirs = sorted(
        path for path in directory.iterdir() if path.is_dir() and not path.name.startswith(".")
    )
    for item_dir in item_dirs:
        if require_manifests and not (item_dir / "item.yaml").is_file():
            raise ProtocolError(f"item manifest not found: {item_dir / 'item.yaml'}", code=3)
    return [item_dir for item_dir in item_dirs if (item_dir / "item.yaml").is_file()]


def collect_active_items(
    paths: dict[str, Path], require_manifests: bool = False
) -> list[tuple[Path, dict[str, Any]]]:
    return [
        (item_dir, normalized_active(item_dir, validate_item(item_dir, paths)))
        for item_dir in item_directories(paths["active"], require_manifests)
    ]


def collect_archive_items(
    paths: dict[str, Path],
    require_manifests: bool = False,
    exhaustive: bool = False,
) -> tuple[list[tuple[Path, dict[str, Any]]], list[dict[str, Any]]]:
    items: list[tuple[Path, dict[str, Any]]] = []
    warnings: list[dict[str, Any]] = []
    for item_dir in item_directories(paths["archive"], require_manifests):
        record, full_errors = validate_archive_operational(item_dir, paths)
        if exhaustive and full_errors:
            raise ProtocolError(f"invalid item {item_dir.name}: " + "; ".join(full_errors))
        if full_errors:
            warnings.append(
                {
                    "id": record["id"],
                    "path": str(item_dir.relative_to(paths["root"])),
                    "issues": full_errors,
                }
            )
        items.append((item_dir, record))
    return items, warnings


def validate_repository_relationships(
    active_items: list[tuple[Path, dict[str, Any]]],
    archive_items: list[tuple[Path, dict[str, Any]]],
) -> None:
    records: dict[str, dict[str, Any]] = {}
    for _, record in active_items + archive_items:
        item_id = str(record["id"])
        if item_id in records:
            raise ProtocolError(f"duplicate item ID across active and archive: {item_id}")
        records[item_id] = record
    for _, record in active_items + archive_items:
        item_id = str(record["id"])
        parent = record.get("parent")
        if parent and parent not in records:
            raise ProtocolError(f"invalid item {item_id}: parent item does not exist: {parent}")
        replacement = record.get("superseded_by")
        if replacement:
            target = records.get(replacement)
            if target is None:
                raise ProtocolError(
                    f"invalid item {item_id}: superseded_by item does not exist: {replacement}"
                )


def collect_operational_repository(
    paths: dict[str, Path],
) -> tuple[
    list[tuple[Path, dict[str, Any]]],
    list[tuple[Path, dict[str, Any]]],
    list[dict[str, Any]],
]:
    active_items = collect_active_items(paths, require_manifests=True)
    archive_items, warnings = collect_archive_items(paths, require_manifests=True)
    validate_repository_relationships(active_items, archive_items)
    return active_items, archive_items, warnings


def render_index(
    paths: dict[str, Path],
    active_items: list[tuple[Path, dict[str, Any]]] | None = None,
    archive_items: list[tuple[Path, dict[str, Any]]] | None = None,
) -> str:
    text = paths["index"].read_text(encoding="utf-8")
    if active_items is None or archive_items is None:
        active_items, archive_items, warnings = collect_operational_repository(paths)
        report_warnings(warnings)
    text = replace_region(text, ACTIVE_START, ACTIVE_END, table_for(active_items, "active"))
    return replace_region(text, ARCHIVE_START, ARCHIVE_END, table_for(archive_items, "archive"))


def update_index(paths: dict[str, Path]) -> list[dict[str, Any]]:
    active_items, archive_items, warnings = collect_operational_repository(paths)
    atomic_write(paths["index"], render_index(paths, active_items, archive_items))
    return warnings


def report_warnings(warnings: list[dict[str, Any]]) -> None:
    for warning in warnings:
        for issue in warning["issues"]:
            print(f"WARNING: {warning['path']}: {issue}", file=sys.stderr)


def item_from_explicit(
    value: str,
    paths: dict[str, Path],
    locations: tuple[str, ...] = ("active",),
) -> Path:
    raw = Path(value).expanduser()
    candidates: list[Path] = []
    if raw.is_absolute():
        candidates.append(raw)
    else:
        candidates.append(paths["root"] / raw)
        candidates.extend(paths[location] / value for location in locations)
    allowed_roots = [paths[location].resolve() for location in locations]
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved.is_file():
            resolved = resolved.parent
        if resolved.is_dir() and (resolved / "item.yaml").is_file():
            if any(resolved.parent == root for root in allowed_roots):
                return resolved
            label = " or ".join(f"spec/{location}" for location in locations)
            raise ProtocolError(f"work item must be located under {label}")
    label = " or ".join(f"spec/{location}" for location in locations)
    raise ProtocolError(f"work item not found under {label}: {value}", code=3)


def resolve_item(
    paths: dict[str, Path],
    explicit: str | None,
    statuses: set[str],
    routes: set[str],
) -> tuple[Path, dict[str, Any]]:
    if explicit:
        item_dir = item_from_explicit(explicit, paths)
        manifest = validate_item(item_dir, paths)
        if statuses and manifest["status"] not in statuses:
            raise ProtocolError(
                f"item {manifest['id']} has status {manifest['status']!r}; expected one of {sorted(statuses)}"
            )
        if routes and manifest["route"] not in routes:
            raise ProtocolError(
                f"item {manifest['id']} has route {manifest['route']!r}; expected one of {sorted(routes)}"
            )
        return item_dir, manifest

    matches: list[tuple[Path, dict[str, Any]]] = []
    for item_dir, manifest in collect_active_items(paths, require_manifests=True):
        if statuses and manifest["status"] not in statuses:
            continue
        if routes and manifest["route"] not in routes:
            continue
        matches.append((item_dir, manifest))
    if not matches:
        raise ProtocolError("no eligible active work item found", code=3)
    if len(matches) > 1:
        ids = ", ".join(manifest["id"] for _, manifest in matches)
        raise ProtocolError(f"multiple eligible active work items found; specify one: {ids}", code=4)
    return matches[0]


def command_create(args: argparse.Namespace, paths: dict[str, Path]) -> None:
    item_id = unique_item_id(paths, args.title, args.id)
    item_dir = paths["active"] / item_id
    item_dir.mkdir(parents=False, exist_ok=False)
    created = now_iso()
    status = "planned" if args.route == "quick-plan" else "discovering"
    manifest: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "id": item_id,
        "title": args.title.strip(),
        "kind": args.kind,
        "work_type": None if args.kind == "initiative" else args.work_type,
        "parent": args.parent,
        "route": args.route,
        "status": status,
        "superseded_by": None,
        "created_at": created,
        "updated_at": created,
        "external_refs": args.external_ref,
        "wiki_refs": args.wiki_ref,
    }
    try:
        write_manifest(item_dir, manifest)
        values = {
            "ID": item_id,
            "TITLE": args.title.strip(),
            "DATE": created.split("T", 1)[0],
            "CREATED_AT": created,
            "UPDATED_AT": created,
        }
        template_name = "plan.md" if args.route == "quick-plan" else "discovery.md"
        content = render_template(paths["templates"] / template_name, values)
        atomic_write(item_dir / template_name, content)
        validate_item(item_dir, paths)
        warnings = update_index(paths)
    except Exception:
        for child in item_dir.iterdir():
            child.unlink()
        item_dir.rmdir()
        raise
    report_warnings(warnings)
    emit(
        {
            "action": "create",
            "id": item_id,
            "path": str(item_dir.relative_to(paths["root"])),
            "status": status,
        }
    )


def parse_csv_set(value: str | None, allowed: set[str], label: str) -> set[str]:
    if not value:
        return set()
    result = {part.strip() for part in value.split(",") if part.strip()}
    invalid = sorted(result - allowed)
    if invalid:
        raise ProtocolError(f"invalid {label}: {', '.join(invalid)}")
    return result


def command_resolve(args: argparse.Namespace, paths: dict[str, Path]) -> None:
    statuses = parse_csv_set(args.status, STATUSES, "statuses")
    routes = parse_csv_set(args.route, ROUTES, "routes")
    item_dir, manifest = resolve_item(paths, args.item, statuses, routes)
    emit(
        {
            "action": "resolve",
            "id": manifest["id"],
            "path": str(item_dir.relative_to(paths["root"])),
            "route": manifest["route"],
            "status": manifest["status"],
        }
    )


def required_archive_artifacts(item_dir: Path, include_outcome: bool) -> None:
    names = ["plan.md", "verification.md"]
    if include_outcome:
        names.append("outcome.md")
    missing = [
        name
        for name in names
        if not (item_dir / name).is_file() or (item_dir / name).is_symlink()
    ]
    if missing:
        raise ProtocolError("archive requires files: " + ", ".join(missing))


def is_immutable_dream_episode(source: Path, root: Path) -> bool:
    """Return whether source is a structurally eligible immutable Dream episode."""
    try:
        relative = source.relative_to(root)
    except ValueError:
        return False
    return (
        source.is_file()
        and not source.is_symlink()
        and relative.parent == Path("wiki/dreams")
        and DREAM_EPISODE_PATTERN.fullmatch(relative.name) is not None
    )


def canonical_reference_sources(paths: dict[str, Path], item_dir: Path) -> list[str]:
    token = f"spec/active/{item_dir.name}"
    sources: list[str] = []
    root = paths["root"]

    def fail_on_traversal_error(error: OSError) -> None:
        location = error.filename or root
        detail = error.strerror or str(error)
        raise ProtocolError(f"cannot inspect Markdown tree at {location}: {detail}")

    for current, directories, names in os.walk(
        root, onerror=fail_on_traversal_error
    ):
        directory = Path(current)
        directories[:] = [
            name
            for name in directories
            if name != ".git" and directory / name != item_dir
        ]
        for name in names:
            source = directory / name
            if source.suffix.lower() not in MARKDOWN_SUFFIXES or source.is_symlink():
                continue
            try:
                text = source.read_text(encoding="utf-8")
            except (OSError, UnicodeError) as exc:
                raise ProtocolError(f"cannot inspect Markdown source {source}: {exc}") from exc
            if token in text and not is_immutable_dream_episode(source, root):
                sources.append(str(source.relative_to(root)))
    return sorted(sources)


def archive_item_paths(
    item_id: str, paths: dict[str, Path], command: str = "archive"
) -> tuple[Path, Path]:
    if not ID_PATTERN.fullmatch(item_id):
        raise ProtocolError(f"{command} --item requires an explicit work item ID")
    return paths["active"] / item_id, paths["archive"] / item_id


def preflight_new_archive(
    item_dir: Path,
    destination: Path,
    paths: dict[str, Path],
    include_outcome: bool,
) -> dict[str, Any]:
    if os.path.lexists(destination):
        raise ProtocolError(f"archive destination already exists: {destination}")
    manifest = validate_item(item_dir, paths)
    if manifest["status"] != "planned":
        raise ProtocolError(
            f"item {manifest['id']} has status {manifest['status']!r}; archive requires planned"
        )
    required_archive_artifacts(item_dir, include_outcome)
    render_index(paths)
    references = canonical_reference_sources(paths, item_dir)
    if references:
        raise ProtocolError(
            f"archive blocked by canonical reference spec/active/{item_dir.name} in: "
            + ", ".join(references)
        )
    return manifest


def finalize_archived_item(
    destination: Path,
    paths: dict[str, Path],
) -> tuple[dict[str, Any], bool]:
    manifest = validate_item(destination, paths, allow_archive_statuses={"planned"})
    if manifest["status"] not in {"planned", "completed"}:
        raise ProtocolError(
            f"archived item {manifest['id']} has unsupported status {manifest['status']!r}"
        )
    required_archive_artifacts(destination, include_outcome=True)
    finalized = manifest["status"] == "planned"
    if finalized:
        manifest = dict(manifest)
        manifest["status"] = "completed"
        manifest["updated_at"] = now_iso()
        write_manifest(destination, manifest)
    manifest = validate_item(destination, paths)
    report_warnings(update_index(paths))
    return manifest, finalized


def command_archive(args: argparse.Namespace, paths: dict[str, Path]) -> None:
    item_dir, destination = archive_item_paths(args.item, paths)
    active_exists = os.path.lexists(item_dir)
    archive_exists = os.path.lexists(destination)
    if active_exists and archive_exists:
        raise ProtocolError(f"item exists in both active and archive: {args.item}")

    relative_source = str(item_dir.relative_to(paths["root"]))
    relative_destination = str(destination.relative_to(paths["root"]))
    if args.check:
        if not active_exists:
            if archive_exists:
                raise ProtocolError(f"archive destination already exists: {destination}")
            raise ProtocolError(f"active work item not found: {args.item}", code=3)
        manifest = preflight_new_archive(
            item_dir, destination, paths, include_outcome=False
        )
        emit(
            {
                "action": "archive",
                "check": True,
                "from": relative_source,
                "id": manifest["id"],
                "status": "completed",
                "to": relative_destination,
                "valid": True,
            }
        )
        return

    recovered = False
    if active_exists:
        preflight_new_archive(item_dir, destination, paths, include_outcome=True)
        os.rename(item_dir, destination)
    elif archive_exists:
        recovered = True
    else:
        raise ProtocolError(f"work item not found: {args.item}", code=3)

    manifest, finalized = finalize_archived_item(destination, paths)
    emit(
        {
            "action": "archive",
            "check": False,
            "finalized": finalized,
            "from": relative_source,
            "id": manifest["id"],
            "recovered": recovered,
            "status": "completed",
            "to": relative_destination,
        }
    )


def required_supersede_outcome(item_dir: Path) -> None:
    outcome = item_dir / "outcome.md"
    if not outcome.is_file() or outcome.is_symlink():
        raise ProtocolError("supersede requires files: outcome.md")


def replacement_item_dir(paths: dict[str, Path], replacement_id: str) -> Path:
    if not ID_PATTERN.fullmatch(replacement_id):
        raise ProtocolError("supersede --replacement requires an explicit work item ID")
    active = paths["active"] / replacement_id
    archive = paths["archive"] / replacement_id
    active_manifest = (active / "item.yaml").is_file()
    archive_manifest = (archive / "item.yaml").is_file()
    if active_manifest and archive_manifest:
        raise ProtocolError(f"item exists in both active and archive: {replacement_id}")
    if active_manifest:
        return active
    if archive_manifest:
        return archive
    raise ProtocolError(f"replacement work item not found: {replacement_id}", code=3)


def validate_replacement_selection(
    paths: dict[str, Path],
    replacement_id: str,
    source_id: str,
) -> dict[str, Any]:
    if replacement_id == source_id:
        raise ProtocolError("replacement must be distinct from the superseded item")
    item_dir = replacement_item_dir(paths, replacement_id)
    manifest = validate_item(item_dir, paths)
    status = manifest["status"]
    if status == "superseded":
        raise ProtocolError(f"replacement {replacement_id} is already superseded")
    if status not in REPLACEMENT_STATUSES:
        raise ProtocolError(
            f"replacement {replacement_id} has status {status!r}; expected an active or completed item"
        )
    return manifest


def preflight_new_supersede(
    item_dir: Path,
    destination: Path,
    paths: dict[str, Path],
    replacement_id: str,
    include_outcome: bool,
) -> dict[str, Any]:
    if os.path.lexists(destination):
        raise ProtocolError(f"archive destination already exists: {destination}")
    manifest = validate_item(item_dir, paths)
    if manifest["status"] not in ACTIVE_STATUSES:
        raise ProtocolError(
            f"item {manifest['id']} has status {manifest['status']!r}; supersede requires an active status"
        )
    if include_outcome:
        required_supersede_outcome(item_dir)
    validate_replacement_selection(paths, replacement_id, manifest["id"])
    render_index(paths)
    references = canonical_reference_sources(paths, item_dir)
    if references:
        raise ProtocolError(
            f"archive blocked by canonical reference spec/active/{item_dir.name} in: "
            + ", ".join(references)
        )
    return manifest


def finalize_superseded_item(
    destination: Path,
    paths: dict[str, Path],
    replacement_id: str,
) -> tuple[dict[str, Any], bool]:
    manifest = validate_item(destination, paths, allow_archive_statuses=set(ACTIVE_STATUSES))
    status = manifest["status"]
    if status in ACTIVE_STATUSES:
        required_supersede_outcome(destination)
        validate_replacement_selection(paths, replacement_id, manifest["id"])
        finalized = True
        manifest = dict(manifest)
        manifest["status"] = "superseded"
        manifest["superseded_by"] = replacement_id
        manifest["updated_at"] = now_iso()
        write_manifest(destination, manifest)
    elif status == "superseded":
        current = manifest.get("superseded_by")
        if current != replacement_id:
            raise ProtocolError(
                f"archived item {manifest['id']} is already superseded by {current!r}"
            )
        finalized = False
    else:
        raise ProtocolError(
            f"archived item {manifest['id']} has unsupported status {status!r}"
        )
    manifest = validate_item(destination, paths)
    report_warnings(update_index(paths))
    return manifest, finalized


def command_supersede(args: argparse.Namespace, paths: dict[str, Path]) -> None:
    item_dir, destination = archive_item_paths(args.item, paths, command="supersede")
    active_exists = os.path.lexists(item_dir)
    archive_exists = os.path.lexists(destination)
    if active_exists and archive_exists:
        raise ProtocolError(f"item exists in both active and archive: {args.item}")

    relative_source = str(item_dir.relative_to(paths["root"]))
    relative_destination = str(destination.relative_to(paths["root"]))
    if args.check:
        if not active_exists:
            if archive_exists:
                raise ProtocolError(f"archive destination already exists: {destination}")
            raise ProtocolError(f"active work item not found: {args.item}", code=3)
        manifest = preflight_new_supersede(
            item_dir,
            destination,
            paths,
            args.replacement,
            include_outcome=False,
        )
        emit(
            {
                "action": "supersede",
                "check": True,
                "from": relative_source,
                "id": manifest["id"],
                "replacement": args.replacement,
                "status": "superseded",
                "to": relative_destination,
                "valid": True,
            }
        )
        return

    recovered = False
    if active_exists:
        preflight_new_supersede(
            item_dir,
            destination,
            paths,
            args.replacement,
            include_outcome=True,
        )
        os.rename(item_dir, destination)
    elif archive_exists:
        recovered = True
    else:
        raise ProtocolError(f"work item not found: {args.item}", code=3)

    manifest, finalized = finalize_superseded_item(destination, paths, args.replacement)
    emit(
        {
            "action": "supersede",
            "check": False,
            "finalized": finalized,
            "from": relative_source,
            "id": manifest["id"],
            "recovered": recovered,
            "replacement": args.replacement,
            "status": "superseded",
            "to": relative_destination,
        }
    )


def command_transition(args: argparse.Namespace, paths: dict[str, Path]) -> None:
    item_dir, manifest = resolve_item(paths, args.item, set(), set())
    original = dict(manifest)
    source = manifest["status"]
    target = args.to
    if target not in TRANSITIONS.get(source, set()):
        raise ProtocolError(f"invalid transition: {source} -> {target}")
    dossiers, dossier_errors = refinement_dossiers(item_dir)
    if dossier_errors:
        raise ProtocolError("invalid refinement artifacts: " + "; ".join(dossier_errors))
    if source == "discovering" and target == "ready_for_spec" and not (
        item_dir / "discovery.md"
    ).is_file():
        raise ProtocolError("initial ready_for_spec requires discovery.md")
    if source == "revision_required" and target == "ready_for_spec" and not dossiers:
        raise ProtocolError(
            "revision ready_for_spec requires a valid current refinements/Rxxx.md"
        )
    if target == "revision_required" and not (item_dir / "plan.md").is_file():
        raise ProtocolError("revision_required requires plan.md")
    if source == "ready_for_spec" and target == "revision_required" and not dossiers:
        raise ProtocolError(
            "ready_for_spec -> revision_required requires a valid current refinements/Rxxx.md"
        )
    if target == "planned" and not (item_dir / "plan.md").is_file():
        raise ProtocolError("planned requires plan.md")
    manifest["status"] = target
    manifest["updated_at"] = now_iso()
    write_manifest(item_dir, manifest)
    try:
        validate_item(item_dir, paths)
        warnings = update_index(paths)
    except Exception:
        write_manifest(item_dir, original)
        raise
    report_warnings(warnings)
    emit({"action": "transition", "id": manifest["id"], "from": source, "to": target})


def validate_exact_references(
    item_dir: Path, manifest: dict[str, Any], paths: dict[str, Path]
) -> None:
    for field in ("parent", "superseded_by"):
        reference = manifest.get(field)
        if not reference:
            continue
        active = paths["active"] / reference
        archive = paths["archive"] / reference
        locations = [path for path in (active, archive) if (path / "item.yaml").is_file()]
        if not locations:
            raise ProtocolError(
                f"invalid item {item_dir.name}: {field} item does not exist: {reference}"
            )
        if len(locations) > 1:
            raise ProtocolError(f"item exists in both active and archive: {reference}")
        target = locations[0]
        if item_location(target, paths) == "active":
            validate_item(target, paths)
        else:
            validate_archive_operational(target, paths)


def command_validate(args: argparse.Namespace, paths: dict[str, Path]) -> None:
    selected = sum(bool(value) for value in (args.item, args.operational, args.all))
    if selected != 1:
        raise ProtocolError(
            "validate requires exactly one of --item, --operational, or --all", code=2
        )
    if args.all:
        active_items = collect_active_items(paths, require_manifests=True)
        archive_items, _ = collect_archive_items(
            paths, require_manifests=True, exhaustive=True
        )
        validate_repository_relationships(active_items, archive_items)
        atomic_write(paths["index"], render_index(paths, active_items, archive_items))
        emit(
            {
                "action": "validate",
                "count": len(active_items) + len(archive_items),
                "mode": "exhaustive",
                "valid": True,
                "warnings": [],
            }
        )
        return
    if args.operational:
        active_items, archive_items, warnings = collect_operational_repository(paths)
        atomic_write(paths["index"], render_index(paths, active_items, archive_items))
        report_warnings(warnings)
        emit(
            {
                "action": "validate",
                "count": len(active_items) + len(archive_items),
                "mode": "operational",
                "valid": True,
                "warnings": warnings,
            }
        )
        return
    item_dir = item_from_explicit(args.item, paths, locations=("active", "archive"))
    manifest = validate_item(item_dir, paths)
    validate_exact_references(item_dir, manifest, paths)
    emit({"action": "validate", "id": manifest["id"], "valid": True})


def command_index(paths: dict[str, Path]) -> None:
    warnings = update_index(paths)
    report_warnings(warnings)
    emit(
        {
            "action": "index",
            "path": str(paths["index"].relative_to(paths["root"])),
            "warnings": warnings,
        }
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Create, resolve, transition, archive, supersede, validate, and index spec work items."
    )
    parser.add_argument("--root", default=".", help="Repository root, default: current directory")
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create", help="Create a non-overwriting active work item")
    create.add_argument("--title", required=True)
    create.add_argument("--id", help="Explicit YYMMDD-HHMM-kebab-slug ID")
    create.add_argument("--route", choices=sorted(ROUTES), required=True)
    create.add_argument("--kind", choices=sorted(KINDS), default="work-item")
    create.add_argument("--work-type", choices=sorted(WORK_TYPES), default="other")
    create.add_argument("--parent")
    create.add_argument("--external-ref", action="append", default=[], type=parse_external_ref)
    create.add_argument("--wiki-ref", action="append", default=[])

    resolve = subparsers.add_parser("resolve", help="Resolve one eligible active work item")
    resolve.add_argument("--item", help="Explicit item ID, directory, or artifact path")
    resolve.add_argument("--status", help="Comma-separated eligible statuses")
    resolve.add_argument("--route", help="Comma-separated eligible routes")

    transition = subparsers.add_parser("transition", help="Apply a current planning transition")
    transition.add_argument("--item", help="Explicit item ID, directory, or artifact path")
    transition.add_argument("--to", choices=sorted(ACTIVE_STATUSES), required=True)

    archive = subparsers.add_parser("archive", help="Complete and archive one planned item")
    archive.add_argument("--item", required=True, help="Explicit work item ID")
    archive.add_argument(
        "--check",
        action="store_true",
        help="Run non-mutating archive preflight without requiring outcome.md",
    )

    supersede = subparsers.add_parser(
        "supersede", help="Archive one active item as superseded by a replacement"
    )
    supersede.add_argument("--item", required=True, help="Explicit work item ID")
    supersede.add_argument(
        "--replacement", required=True, help="Explicit replacement work item ID"
    )
    supersede.add_argument(
        "--check",
        action="store_true",
        help="Run non-mutating supersede preflight without requiring outcome.md",
    )

    validate = subparsers.add_parser(
        "validate", help="Validate one item, operational readiness, or exhaustive history"
    )
    validate.add_argument("--item", help="Explicit item ID, directory, or artifact path")
    validate.add_argument(
        "--operational",
        action="store_true",
        help="Validate current work and the operational archive envelope; warn on audit-only defects",
    )
    validate.add_argument("--all", action="store_true", help="Run the exhaustive repository audit")

    subparsers.add_parser("index", help="Regenerate managed spec index tables")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    root = Path(args.root).expanduser().resolve()
    if not root.is_dir():
        print(f"ERROR: repository root is not a directory: {root}", file=sys.stderr)
        return 2
    paths = protocol_paths(root)
    try:
        require_protocol(paths)
        if args.command == "create":
            command_create(args, paths)
        elif args.command == "resolve":
            command_resolve(args, paths)
        elif args.command == "transition":
            command_transition(args, paths)
        elif args.command == "archive":
            command_archive(args, paths)
        elif args.command == "supersede":
            command_supersede(args, paths)
        elif args.command == "validate":
            command_validate(args, paths)
        elif args.command == "index":
            command_index(paths)
        else:
            parser.error(f"unknown command: {args.command}")
    except ProtocolError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return exc.code
    except (OSError, yaml.YAMLError) as exc:
        print(f"ERROR: filesystem or YAML operation failed: {exc}", file=sys.stderr)
        return 6
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
