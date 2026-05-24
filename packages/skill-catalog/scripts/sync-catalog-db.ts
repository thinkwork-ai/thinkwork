/**
 * Retired compatibility entry point.
 *
 * The skill catalog is now S3-backed and seeded by bootstrap-workspace.sh.
 * Keeping this script as a no-op lets older operational wrappers fail soft
 * while the package is phased out.
 */

console.log("DB catalog sync is retired; S3 is the skill catalog source.");
