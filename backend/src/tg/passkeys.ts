import { TelegramClient } from "telegram";
import { serializeBytes } from "telegram/tl/generationHelpers";

// GramJS (TL layer 198) does not yet ship Telegram's passkey types, so we build
// these requests and parse their responses by hand from the documented schema:
//   account.getPasskeys#ea1f0c52 = account.Passkeys;
//   account.passkeys#f8e0aa1c passkeys:Vector<Passkey> = account.Passkeys;
//   passkey#98613ebf flags:# id:string name:string date:int
//                    software_emoji_id:flags.0?long last_usage_date:flags.1?int = Passkey;
//   account.deletePasskey#f5b5563f id:string = Bool;
// See https://core.telegram.org/api/passkeys

const GET_PASSKEYS_ID = 0xea1f0c52;
const DELETE_PASSKEY_ID = 0xf5b5563f;
const BOOL_TRUE_ID = 0x997275b5;

export type Passkey = {
  id: string;
  name: string;
  date: number;
  softwareEmojiId: string | null;
  lastUsageDate: number | null;
};

// A minimal request object shaped like a GramJS TLRequest: invoke() only needs
// classType, resolve(), getBytes() and readResult().
class GetPasskeysRequest {
  CONSTRUCTOR_ID = GET_PASSKEYS_ID;
  SUBCLASS_OF_ID = 0;
  className = "account.getPasskeys";
  classType = "request" as const;

  async resolve() {
    /* no entity params to resolve */
  }

  getBytes(): Buffer {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(this.CONSTRUCTOR_ID, 0);
    return b;
  }

  // Returns an object (not a bare array) so GramJS's post-invoke entity
  // processing safely finds no users/chats and no-ops.
  readResult(reader: any): { passkeys: Passkey[] } {
    reader.readInt(false); // account.passkeys#f8e0aa1c
    reader.readInt(false); // Vector 0x1cb5c415
    const count = reader.readInt();
    const passkeys: Passkey[] = [];
    for (let i = 0; i < count; i++) {
      reader.readInt(false); // passkey#98613ebf
      const flags = reader.readInt();
      const id = reader.tgReadString();
      const name = reader.tgReadString();
      const date = reader.readInt();
      const softwareEmojiId = flags & 1 ? reader.readLong() : null;
      const lastUsageDate = flags & 2 ? reader.readInt() : null;
      passkeys.push({
        id,
        name,
        date,
        softwareEmojiId: softwareEmojiId != null ? String(softwareEmojiId) : null,
        lastUsageDate: lastUsageDate ?? null,
      });
    }
    return { passkeys };
  }
}

class DeletePasskeyRequest {
  CONSTRUCTOR_ID = DELETE_PASSKEY_ID;
  SUBCLASS_OF_ID = 0;
  className = "account.deletePasskey";
  classType = "request" as const;

  constructor(private readonly passkeyId: string) {}

  async resolve() {
    /* no entity params to resolve */
  }

  getBytes(): Buffer {
    const head = Buffer.alloc(4);
    head.writeUInt32LE(this.CONSTRUCTOR_ID, 0);
    return Buffer.concat([head, serializeBytes(this.passkeyId)]);
  }

  readResult(reader: any): boolean {
    return reader.readInt(false) === BOOL_TRUE_ID;
  }
}

export async function invokeGetPasskeys(
  client: TelegramClient,
): Promise<Passkey[]> {
  const result = (await client.invoke(new GetPasskeysRequest() as any)) as {
    passkeys: Passkey[];
  };
  return result.passkeys;
}

export async function invokeDeletePasskey(
  client: TelegramClient,
  passkeyId: string,
): Promise<boolean> {
  return client.invoke(new DeletePasskeyRequest(passkeyId) as any);
}
