// A visit answers to two identifiers, and every endpoint under `/visits/:visitId`
// has to accept both. The server's own cuid is one; the other is the
// `clientVisitId` the device minted when the rep started the visit with no
// signal, which for a while is the only id their phone has — the URL they are
// standing on is built from it, and it must not become a dead link the moment
// the create syncs and the server assigns its own.
//
// There is a third place a client id can live. A deferred start that finds the
// stop's visit slot already held by the rep's own open visit is handed that
// visit rather than creating one, and the id it minted is recorded in
// `VisitClientAlias` — a URL built from it must keep working just the same. See
// that model's own comment for why the adopt case needs a table where the
// create case needs only a column.
//
// The order is the whole content of this module. `clientVisitId` is client
// input: a device (or a rep who edits what their device sends) can mint one
// equal to another visit's real server id. Resolved as a single
// `OR: [{ id }, { clientVisitId }]`, that lets `findFirst` return either
// matching row indeterminately — a manager opening a visit by its real id could
// be served the impostor. Separate queries with the server id tried first make a
// real id always win, and cost nothing extra in the ordinary case, where the
// first one matches. The alias is tried last for the same reason, and only ever
// reached by an id no visit of its own answers to.
//
// Every caller keeps its own `select`/`include` by passing the query in, so
// this stays the rule and nothing else.

export type VisitIdentityWhere = {
  tenantId: string;
  id?: string;
  clientVisitId?: string;
};

// Structural rather than the generated Prisma delegate, so this module keeps
// depending on nothing — the callers hand in `this.prisma`.
export type VisitAliasLookup = {
  visitClientAlias: {
    findUnique(args: {
      where: {
        tenantId_clientVisitId: { tenantId: string; clientVisitId: string };
      };
      select: { visitId: true };
    }): Promise<{ visitId: string } | null>;
  };
};

export async function findVisitByEitherId<TVisit>(
  aliases: VisitAliasLookup,
  runQuery: (where: VisitIdentityWhere) => Promise<TVisit | null>,
  tenantId: string,
  visitId: string,
): Promise<TVisit | null> {
  const byServerId = await runQuery({ tenantId, id: visitId });

  if (byServerId) {
    return byServerId;
  }

  const byClientId = await runQuery({ tenantId, clientVisitId: visitId });

  if (byClientId) {
    return byClientId;
  }

  const alias = await aliases.visitClientAlias.findUnique({
    where: { tenantId_clientVisitId: { tenantId, clientVisitId: visitId } },
    select: { visitId: true },
  });

  // Re-queried by server id rather than joined, so the caller's own
  // `select`/`include` still decides the shape — and so a dangling alias
  // (impossible today: the row cascades with its visit) reads as not found.
  return alias ? runQuery({ tenantId, id: alias.visitId }) : null;
}
