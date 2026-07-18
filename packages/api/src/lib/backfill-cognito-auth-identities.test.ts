import { describe, expect, it, vi } from "vitest";
import {
  buildIdentityBackfillPlan,
  listEveryWorkosUser,
  parseCognitoInventoryUser,
  type BackfillConnection,
  type CognitoInventoryUser,
  type DatabaseIdentityUser,
} from "../../scripts/backfill-cognito-auth-identities.js";

const issuer = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Example";
const tenantId = "12345678-1234-4123-8123-123456789abc";
const connections: BackfillConnection[] = [
  {
    id: "local-resource",
    connectionKey: "local",
    providerKind: "local",
    cognitoIdentityProviderName: "COGNITO",
    issuerUrl: issuer,
  },
  {
    id: "google-resource",
    connectionKey: "google",
    providerKind: "google",
    cognitoIdentityProviderName: "Google",
    issuerUrl: "https://accounts.google.com/",
  },
];

function dbUser(id: string, cognitoSub: string): DatabaseIdentityUser {
  return { id, tenantId, cognitoSub };
}

function cognitoUser(
  sub: string,
  identities: CognitoInventoryUser["identities"] = [],
): CognitoInventoryUser {
  return { username: sub, sub, identities };
}

describe("Cognito auth identity backfill", () => {
  it("parses Cognito's identities attribute without retaining email/profile data", () => {
    const parsed = parseCognitoInventoryUser({
      Username: "native-user",
      Attributes: [
        { Name: "sub", Value: "cognito-sub" },
        { Name: "email", Value: "private@example.com" },
        {
          Name: "identities",
          Value: JSON.stringify([
            {
              providerName: "Google",
              providerType: "Google",
              userId: "google-subject",
              primary: true,
              dateCreated: "1234",
            },
          ]),
        },
      ],
    });
    expect(parsed).toEqual({
      username: "native-user",
      sub: "cognito-sub",
      identities: [
        {
          providerName: "Google",
          providerType: "Google",
          userId: "google-subject",
          primary: true,
        },
      ],
    });
    expect(JSON.stringify(parsed)).not.toContain("private@example.com");
  });

  it("classifies native local and healed Google identities exactly", () => {
    const plan = buildIdentityBackfillPlan({
      databaseUsers: [
        dbUser("user-local", "sub-local"),
        dbUser("user-g", "sub-g"),
      ],
      cognitoUsers: [
        cognitoUser("sub-local"),
        cognitoUser("sub-g", [
          { providerName: "Google", userId: "google-subject" },
        ]),
      ],
      connections,
      cognitoIssuer: issuer,
    });

    expect(plan.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: "user-local",
          authProviderResourceId: "local-resource",
          providerKind: "local",
          providerSubject: "sub-local",
          status: "active",
        }),
        expect.objectContaining({
          userId: "user-g",
          authProviderResourceId: "google-resource",
          providerKind: "google",
          providerSubject: "google-subject",
          status: "active",
        }),
      ]),
    );
    expect(plan.findings).toEqual([]);
  });

  it("quarantines ambiguous, unknown, and database-only evidence", () => {
    const plan = buildIdentityBackfillPlan({
      databaseUsers: [
        dbUser("ambiguous", "sub-a"),
        dbUser("unknown", "sub-u"),
        dbUser("missing", "sub-m"),
      ],
      cognitoUsers: [
        cognitoUser("sub-a", [
          { providerName: "Google", userId: "g" },
          { providerName: "Microsoft", userId: "m" },
        ]),
        cognitoUser("sub-u", [
          { providerName: "Unregistered", userId: "external" },
        ]),
      ],
      connections,
      cognitoIssuer: issuer,
    });
    expect(plan.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: "ambiguous",
          status: "quarantined",
          reasonCode: "multiple_provider_identities",
        }),
        expect.objectContaining({
          userId: "unknown",
          status: "quarantined",
          reasonCode: "provider_connection_missing",
        }),
        expect.objectContaining({
          userId: "missing",
          status: "quarantined",
          reasonCode: "cognito_profile_missing",
        }),
      ]),
    );
  });

  it("allows one ThinkWork user to hold six distinct Cognito identities", () => {
    const databaseUsers = Array.from({ length: 6 }, (_, index) =>
      dbUser("same-user", `sub-${index}`),
    );
    const plan = buildIdentityBackfillPlan({
      databaseUsers,
      cognitoUsers: databaseUsers.map((user) => cognitoUser(user.cognitoSub)),
      connections,
      cognitoIssuer: issuer,
    });
    expect(plan.entries).toHaveLength(6);
    expect(plan.entries.every((entry) => entry.userId === "same-user")).toBe(
      true,
    );
    expect(new Set(plan.entries.map((entry) => entry.cognitoSub)).size).toBe(6);
  });

  it("records unbound and duplicate-sub conflicts as digested findings", () => {
    const plan = buildIdentityBackfillPlan({
      databaseUsers: [
        dbUser("one", "raw-duplicate-subject"),
        dbUser("two", "raw-duplicate-subject"),
      ],
      cognitoUsers: [
        cognitoUser("raw-duplicate-subject"),
        cognitoUser("raw-unbound-subject"),
      ],
      connections,
      cognitoIssuer: issuer,
    });
    expect(plan.entries).toEqual([]);
    expect(plan.findings.map((finding) => finding.reasonCode).sort()).toEqual([
      "cognito_user_unbound",
      "duplicate_database_sub",
    ]);
    expect(JSON.stringify(plan.findings)).not.toContain(
      "raw-duplicate-subject",
    );
    expect(JSON.stringify(plan.findings)).not.toContain("raw-unbound-subject");
  });

  it("classifies every WorkOS directory user from exact session-to-Cognito evidence", () => {
    const plan = buildIdentityBackfillPlan({
      databaseUsers: [
        dbUser("mapped", "sub-mapped"),
        dbUser("quarantined", "sub-quarantined"),
      ],
      cognitoUsers: [
        cognitoUser("sub-mapped"),
        cognitoUser("sub-quarantined", [
          { providerName: "Unknown", userId: "external" },
        ]),
      ],
      connections,
      cognitoIssuer: issuer,
      workosDirectoryComplete: true,
      workosDirectoryUsers: [
        { id: "workos-mapped" },
        { id: "workos-quarantined" },
        { id: "workos-unbound" },
      ],
      workosSessionBindings: [
        { workosUserId: "workos-mapped", cognitoSub: "sub-mapped" },
        {
          workosUserId: "workos-quarantined",
          cognitoSub: "sub-quarantined",
        },
      ],
    });

    expect(plan.workosDirectoryComplete).toBe(true);
    expect(plan.workosDispositions.map((entry) => entry.status).sort()).toEqual(
      ["mapped", "quarantined", "unresolved"],
    );
    expect(JSON.stringify(plan.workosDispositions)).not.toContain(
      "workos-unbound",
    );
  });

  it("paginates the WorkOS directory with bearer auth and retains ids only", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: "user-1", email: "private@example.com" }],
            list_metadata: { after: "user-1" },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: "user-2", email: "private2@example.com" }],
            list_metadata: { after: null },
          }),
          { status: 200 },
        ),
      );

    await expect(listEveryWorkosUser("secret", fetchMock)).resolves.toEqual([
      { id: "user-1" },
      { id: "user-2" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("after=user-1");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer secret" },
    });
  });
});
