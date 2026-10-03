"""JSON schemas and constants for shared-library release tooling."""

RELEASE_RECORD_FIELDS = (
    "library",
    "gasVersion",
    "gitSha",
    "description",
    "releasedAt",
    "consumerPinsBefore",
    "consumerPinsAfter",
    "affectedConsumers",
    "verification",
)

PLAN_SCHEMA_VERSION = 1
