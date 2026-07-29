#!/usr/bin/env python3
"""Child-process worker: read the fixture from stdin, run the Forge Python
WRL spine, write a JSON result to stdout.

This file is spawned as a SEPARATE child process by the orchestrator.

Usage:  python3 run-python.py <forge_dir> < fixture.json
  stdin:   the fixture JSON (with .source and .wire fields)
  argv 1:  path to the directory containing wrl_canonical.py and wrl_projection.py
  stdout:  JSON result object
"""
import hashlib
import json
import os
import platform
import socket
import subprocess
import sys

sys.dont_write_bytecode = True


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("run-python.py: missing forge_dir argument\n")
        sys.exit(2)

    forge_dir = os.path.abspath(sys.argv[1])

    # Read fixture from stdin
    fixture = json.loads(sys.stdin.read())

    # Compute implementation file digest
    projection_path = os.path.join(forge_dir, "wrl_projection.py")
    if not os.path.isfile(projection_path):
        # Try the probe directory
        projection_path = os.path.join(forge_dir, "wrl_projection.py")

    impl_bytes = open(projection_path, "rb").read()
    impl_digest = hashlib.sha256(impl_bytes).hexdigest()

    # Git revision
    git_rev = "unknown"
    try:
        git_rev = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            timeout=5, text=True
        ).strip()
    except Exception:
        pass

    result = {
        "implementation_name": "forge-python-spine",
        "repository_revision": git_rev,
        "impl_file_digest_sha256": impl_digest,
        "host_fingerprint": {
            "hostname": socket.gethostname(),
            "platform": sys.platform,
            "arch": platform.machine(),
        },
        "process_id": os.getpid(),
        "computed_semantic_artifact_id": None,
        "verification_result": "error",
        "expected_identifier": None,
        "identifier_discrepancy": None,
    }

    # Extract expected identifier from the wire
    try:
        wire_obj = json.loads(fixture["wire"])
        result["expected_identifier"] = wire_obj.get("semantic_world_id")
    except Exception:
        pass

    try:
        # Add forge_dir to sys.path so wrl_canonical and wrl_projection can import
        if forge_dir not in sys.path:
            sys.path.insert(0, forge_dir)

        import wrl_projection as P

        # Verify the wire bytes through the projection pipeline
        admission = P.verify_runtime_projection(fixture["wire"])
        result["computed_semantic_artifact_id"] = admission.semantic_world_id

        expected_id = result["expected_identifier"]
        if admission.semantic_world_id == expected_id:
            result["verification_result"] = "pass"
            result["identifier_discrepancy"] = None
        else:
            result["verification_result"] = "fail"
            result["identifier_discrepancy"] = (
                "computed %s, expected %s"
                % (admission.semantic_world_id, expected_id)
            )
    except Exception as e:
        result["verification_result"] = "error"
        result["identifier_discrepancy"] = "exception: %s: %s" % (
            type(e).__name__, e
        )

    sys.stdout.write(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
