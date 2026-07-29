#!/usr/bin/env python3
"""Child-process worker: read the fixture from stdin, run the Forge Python
WRL spine, write a JSON result to stdout.

This file is spawned as a SEPARATE child process by the orchestrator.

Usage:  python3 run-python.py <dir1> [<dir2> ...] < fixture.json
  stdin:   the fixture JSON (with .source and .wire fields)
  argv:    one or more directories to add to sys.path (must collectively
           contain wrl_projection.py and wrl_canonical.py)
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
    dirs = [os.path.abspath(d) for d in sys.argv[1:]]
    if not dirs:
        sys.stderr.write("run-python.py: missing directory argument(s)\n")
        sys.exit(2)

    # Add all directories to sys.path
    for d in dirs:
        if d not in sys.path:
            sys.path.insert(0, d)

    # Read fixture from stdin
    fixture = json.loads(sys.stdin.read())

    # Find wrl_projection.py across the provided directories
    projection_path = None
    for d in dirs:
        p = os.path.join(d, "wrl_projection.py")
        if os.path.isfile(p):
            projection_path = p
            break
    if projection_path is None:
        sys.stderr.write("run-python.py: wrl_projection.py not found in %s\n"
                         % ", ".join(dirs))
        sys.exit(2)

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
