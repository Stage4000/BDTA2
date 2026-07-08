import { createPublicContact, PublicContactError, type PublicContactDependencies } from "@bdta/application";

type TestClient = {
  clientId: string;
  name: string;
  email: string;
  phone: string;
  notes: string;
};

function createDependencies(
  clients: TestClient[],
  overrides: Partial<PublicContactDependencies> = {}
): PublicContactDependencies {
  let sequence = clients.length;

  const base: PublicContactDependencies = {
    now: () => "2026-05-26T18:00:00.000Z",
    verifyCaptcha: async () => true,
    findLatestClientByEmail: async (email) => {
      const normalizedEmail = email.trim().toLowerCase();
      const match = [...clients].reverse().find((client) => client.email === normalizedEmail) ?? null;
      return match == null ? null : {
        clientId: match.clientId,
        notes: match.notes
      };
    },
    updateClientNotes: async (clientId, notes) => {
      const index = clients.findIndex((client) => client.clientId === clientId);
      if (index >= 0) {
        clients[index] = {
          ...clients[index],
          notes
        };
      }
    },
    createClientLead: async (input) => {
      sequence += 1;
      const client = {
        clientId: `client-${sequence}`,
        name: input.name,
        email: input.email,
        phone: input.phone,
        notes: input.notes
      };
      clients.push(client);
      return {
        clientId: client.clientId
      };
    }
  };

  return {
    ...base,
    ...overrides
  };
}

describe("public contact service", () => {
  it("creates a new client lead and stores the contact message in notes", async () => {
    const clients: TestClient[] = [];

    const result = await createPublicContact(
      {
        name: "Contact New",
        email: "Contact-New@Example.com",
        phone: "555-1100",
        service: "pet-sitting",
        message: "Need help with training basics.",
        turnstileToken: "turnstile-ok"
      },
      createDependencies(clients)
    );

    expect(result).toEqual({ success: true });
    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({
      name: "Contact New",
      email: "contact-new@example.com",
      phone: "555-1100"
    });
    expect(clients[0]?.notes).toContain("Public contact form message submitted on 2026-05-26T18:00:00.000Z");
    expect(clients[0]?.notes).toContain("Service interested in: pet-sitting");
    expect(clients[0]?.notes).toContain("Message: Need help with training basics.");
  });

  it("updates only the latest duplicate client record and appends the new note", async () => {
    const clients: TestClient[] = [
      {
        clientId: "client-1",
        name: "Older Duplicate",
        email: "contact-existing@example.com",
        phone: "555-9999",
        notes: "Old duplicate note"
      },
      {
        clientId: "client-2",
        name: "Old Name",
        email: "contact-existing@example.com",
        phone: "555-0000",
        notes: "Existing note"
      }
    ];

    const result = await createPublicContact(
      {
        name: "Attempted Update Name",
        email: "CONTACT-EXISTING@EXAMPLE.COM",
        phone: "555-2200",
        service: "walking",
        message: "Second message from existing contact.",
        turnstileToken: "turnstile-ok"
      },
      createDependencies(clients)
    );

    expect(result).toEqual({ success: true });
    expect(clients[0]?.notes).toBe("Old duplicate note");
    expect(clients[1]).toMatchObject({
      name: "Old Name",
      phone: "555-0000"
    });
    expect(clients[1]?.notes).toContain("Existing note");
    expect(clients[1]?.notes).toContain("Service interested in: walking");
    expect(clients[1]?.notes).toContain("Message: Second message from existing contact.");
  });

  it("rejects invalid email addresses", async () => {
    const clients: TestClient[] = [];

    await expect(createPublicContact(
      {
        name: "Contact New",
        email: "not-an-email",
        phone: "555-1100",
        service: "",
        message: "Need help.",
        turnstileToken: "turnstile-ok"
      },
      createDependencies(clients)
    )).rejects.toMatchObject({
      code: "validation_failed",
      message: "Please enter a valid email address."
    } satisfies Pick<PublicContactError, "code" | "message">);
  });

  it("rejects failed captcha verification", async () => {
    const clients: TestClient[] = [];

    await expect(createPublicContact(
      {
        name: "Contact New",
        email: "contact@example.com",
        phone: "555-1100",
        service: "",
        message: "Need help.",
        turnstileToken: "turnstile-fail"
      },
      createDependencies(clients, {
        verifyCaptcha: async () => false
      })
    )).rejects.toMatchObject({
      code: "captcha_failed",
      message: "Please confirm you are not a robot and try again."
    } satisfies Pick<PublicContactError, "code" | "message">);
  });
});
