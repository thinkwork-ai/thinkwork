from __future__ import annotations

from datetime import UTC, datetime
from io import BytesIO


class FakeS3:
    def __init__(self, response=None, exc=None):
        self.response = response
        self.exc = exc
        self.calls = []

    def get_object(self, **kwargs):
        self.calls.append(kwargs)
        if self.exc:
            raise self.exc
        return self.response


class FakeClientError(Exception):
    def __init__(self, code):
        self.response = {"Error": {"Code": code}}
        super().__init__(code)


def test_user_knowledge_pack_key_is_user_scoped():
    from user_storage import user_knowledge_pack_key

    assert (
        user_knowledge_pack_key("tenant-1", "user-1")
        == "tenants/tenant-1/users/user-1/knowledge-pack.md"
    )


def test_get_user_knowledge_pack_reads_body_etag_and_last_modified():
    from user_storage import get_user_knowledge_pack

    last_modified = datetime(2026, 4, 26, tzinfo=UTC)
    s3 = FakeS3(
        {
            "Body": BytesIO(b"<user_distilled_knowledge_x>hello</user_distilled_knowledge_x>"),
            "ETag": '"abc123"',
            "LastModified": last_modified,
        }
    )

    result = get_user_knowledge_pack(
        "tenant-1",
        "user-1",
        bucket="workspace-bucket",
        s3_client=s3,
    )

    assert result is not None
    assert result.body.startswith("<user_distilled_knowledge_x>")
    assert result.etag == "abc123"
    assert result.last_modified == last_modified
    assert s3.calls == [
        {
            "Bucket": "workspace-bucket",
            "Key": "tenants/tenant-1/users/user-1/knowledge-pack.md",
        }
    ]


def test_get_user_knowledge_pack_returns_none_for_missing_pack():
    from user_storage import get_user_knowledge_pack

    result = get_user_knowledge_pack(
        "tenant-1",
        "user-1",
        bucket="workspace-bucket",
        s3_client=FakeS3(exc=FakeClientError("NoSuchKey")),
    )

    assert result is None


def test_get_user_knowledge_pack_rejects_traversal_ids_without_s3_call():
    from user_storage import get_user_knowledge_pack

    s3 = FakeS3({})

    result = get_user_knowledge_pack(
        "tenant-1",
        "../user",
        bucket="workspace-bucket",
        s3_client=s3,
    )

    assert result is None
    assert s3.calls == []
