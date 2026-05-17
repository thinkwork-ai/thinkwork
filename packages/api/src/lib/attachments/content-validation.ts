/**
 * Server-side content validation for finalized thread-attachment uploads
 * (U2 of the finance analysis pilot).
 *
 * The presign step is permissive — it issues a presigned PUT against a
 * staging key without knowing the file bytes. Finalize is where the
 * actual content gets inspected: magic-byte sniffing (catches `.exe`
 * renamed to `.xlsx`), OOXML container scan (rejects macros + external
 * links), and zip-bomb defense (cap on decompressed/compressed ratio
 * and total entries).
 *
 * Two layers:
 *  - `verifyMagicBytes(buffer, declaredExtension)` — fast prefix check.
 *  - `validateOoxmlSafety(buffer)` — full container walk for .xlsx files.
 *    Reuses the existing `inspectZipBuffer` from `plugin-zip-safety.ts`
 *    (already covers path-escape, entry-count, decompressed-size, and
 *    symlink defenses) and adds OOXML-specific entry rejections.
 *
 * `.xls` (legacy binary), `.csv`, and plain-text documents skip the
 * OOXML scan — they aren't zip containers. Magic-byte verification
 * still applies.
 */

import { inspectZipBuffer } from "../plugin-zip-safety.js";

/**
 * Magic-byte prefixes for the pilot's allowed file types. Verified
 * against the first N bytes of the uploaded body to catch
 * extension-rename attacks (an `.exe` returned as declared MIME `.xlsx`
 * would sniff to a PE/MZ header, not OOXML).
 */
const MAGIC_BYTES: Record<string, ReadonlyArray<readonly number[]>> = {
	// OOXML containers are ZIP archives — `PK\x03\x04` is the local file
	// header. `PK\x05\x06` (empty archive) and `PK\x07\x08` (spanned) are
	// extremely unusual for a real workbook; reject them.
	".xlsx": [[0x50, 0x4b, 0x03, 0x04]],
	// Legacy binary Excel: CFBF magic.
	".xls": [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
	// Text files have no single magic-byte sequence. We accept anything
	// whose first bytes are printable-ASCII / common BOMs and leave
	// stronger validation to the consumer.
	".csv": [
		[0xef, 0xbb, 0xbf], // UTF-8 BOM
	],
	".md": [
		[0xef, 0xbb, 0xbf], // UTF-8 BOM
	],
	".txt": [
		[0xef, 0xbb, 0xbf], // UTF-8 BOM
	],
	".pdf": [[0x25, 0x50, 0x44, 0x46]], // %PDF
};

export interface MagicByteFailure {
	ok: false;
	reason: "magic_byte_mismatch" | "buffer_too_short" | "unsupported_extension";
	expectedFor?: string;
}

export interface MagicByteSuccess {
	ok: true;
}

export type MagicByteResult = MagicByteFailure | MagicByteSuccess;

/**
 * Verify the first N bytes of `buffer` match one of the magic-byte
 * sequences registered for `declaredExtension` (lowercase, leading `.`).
 *
 * Text formats are special-cased: most have no magic prefix, so we
 * accept any buffer whose first 4 bytes are printable ASCII or one of
 * the registered BOMs. Other extensions require an exact prefix match.
 */
export function verifyMagicBytes(
	buffer: Buffer,
	declaredExtension: string,
): MagicByteResult {
	const ext = declaredExtension.toLowerCase();
	const expectedPrefixes = MAGIC_BYTES[ext];
	if (!expectedPrefixes) {
		return { ok: false, reason: "unsupported_extension" };
	}
	if (TEXT_EXTENSIONS.has(ext)) {
		// Text — accept the registered BOM OR printable-ASCII prefix.
		if (buffer.length === 0) {
			return { ok: false, reason: "buffer_too_short" };
		}
		for (const prefix of expectedPrefixes) {
			if (matchesPrefix(buffer, prefix)) return { ok: true };
		}
		// Fallback: first 4 bytes printable ASCII or common whitespace.
		const head = buffer.subarray(0, Math.min(4, buffer.length));
		let printable = true;
		for (const b of head) {
			const isPrintable = b >= 0x20 && b <= 0x7e;
			const isWhitespace = b === 0x09 || b === 0x0a || b === 0x0d;
			if (!isPrintable && !isWhitespace) {
				printable = false;
				break;
			}
		}
		return printable
			? { ok: true }
			: { ok: false, reason: "magic_byte_mismatch", expectedFor: ext };
	}
	for (const prefix of expectedPrefixes) {
		if (matchesPrefix(buffer, prefix)) return { ok: true };
	}
	return { ok: false, reason: "magic_byte_mismatch", expectedFor: ext };
}

const TEXT_EXTENSIONS = new Set([".csv", ".md", ".txt"]);

function matchesPrefix(buffer: Buffer, prefix: readonly number[]): boolean {
	if (buffer.length < prefix.length) return false;
	for (let i = 0; i < prefix.length; i++) {
		if (buffer[i] !== prefix[i]) return false;
	}
	return true;
}

export interface OoxmlSafetyFailure {
	ok: false;
	reason:
		| "macro_enabled"
		| "external_links"
		| "zip_malformed"
		| "zip_path_escape"
		| "zip_too_many_entries"
		| "zip_decompressed_too_large"
		| "zip_symlink_present";
	detail?: string;
}

export interface OoxmlSafetySuccess {
	ok: true;
	entryCount: number;
}

export type OoxmlSafetyResult = OoxmlSafetyFailure | OoxmlSafetySuccess;

/**
 * Walk the OOXML container and reject:
 *   - `xl/vbaProject.bin` — macros (the #1 vector for malicious workbooks)
 *   - `xl/externalLinks/` — data-exfiltration via cross-workbook references
 *   - Zip-bomb / path-escape / symlink trickery (delegated to
 *     `inspectZipBuffer`, which is the existing repo-wide zip safety
 *     utility used by plugin-upload).
 *
 * Order matters: zip-safety runs first so a malformed or oversized zip
 * fails closed BEFORE we walk entries looking for macro markers.
 */
export async function validateOoxmlSafety(
	buffer: Buffer,
): Promise<OoxmlSafetyResult> {
	const safety = await inspectZipBuffer(buffer);
	if (!safety.valid) {
		// `inspectZipBuffer` may surface multiple errors; the first one
		// is the load-bearing rejection. Map the plugin-zip-safety
		// kinds onto our finer-grained vocabulary.
		const first = safety.errors[0]!;
		const detail =
			typeof first.details?.path === "string"
				? (first.details.path as string)
				: undefined;
		switch (first.kind) {
			case "ZipPathEscape":
			case "ZipPathTooLong":
				return { ok: false, reason: "zip_path_escape", detail };
			case "ZipDecompressedTooLarge":
				return { ok: false, reason: "zip_decompressed_too_large" };
			case "ZipTooManyEntries":
				return { ok: false, reason: "zip_too_many_entries" };
			case "ZipSymlinkNotAllowed":
				return { ok: false, reason: "zip_symlink_present", detail };
			case "ZipMalformed":
				return {
					ok: false,
					reason: "zip_malformed",
					detail: first.message,
				};
		}
	}

	for (const entry of safety.entries) {
		const norm = entry.path.replace(/\\/g, "/").toLowerCase();
		if (norm === "xl/vbaproject.bin" || norm.endsWith("/vbaproject.bin")) {
			return {
				ok: false,
				reason: "macro_enabled",
				detail: entry.path,
			};
		}
		if (norm.startsWith("xl/externallinks/")) {
			return {
				ok: false,
				reason: "external_links",
				detail: entry.path,
			};
		}
	}

	return { ok: true, entryCount: safety.entries.length };
}
