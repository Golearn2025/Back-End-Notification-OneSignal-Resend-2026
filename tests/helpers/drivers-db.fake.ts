import { vi } from 'vitest';

/** Fake supabase drivers table supporting both maybeSingle and batch .in() lookups. */
export function makeDriversDb(options?: {
  authForId?: (driverId: string) => string;
  sequential?: boolean;
}) {
  let seq = 0;
  const authForId =
    options?.authForId ??
    ((driverId: string) => {
      if (options?.sequential) {
        seq += 1;
        return `auth-${seq}`;
      }
      return `auth-${driverId}`;
    });

  return {
    from: vi.fn(() => {
      let lastEqId: string | null = null;
      const api: any = {
        select: vi.fn(() => api),
        eq: vi.fn((col: string, val: string) => {
          if (col === 'id') lastEqId = val;
          return api;
        }),
        in: vi.fn((_col: string, ids: string[]) =>
          Promise.resolve({
            data: ids.map((id) => ({ id, auth_user_id: authForId(id) })),
            error: null
          })
        ),
        maybeSingle: vi.fn(async () => {
          const id = lastEqId ?? `d-${seq + 1}`;
          return { data: { auth_user_id: authForId(id) }, error: null };
        })
      };
      return api;
    })
  };
}
