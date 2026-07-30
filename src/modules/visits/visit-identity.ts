// A visit answers to two identifiers, and every endpoint under `/visits/:visitId`
// has to accept both. The server's own cuid is one; the other is the
// `clientVisitId` the device minted when the rep started the visit with no
// signal, which for a while is the only id their phone has — the URL they are
// standing on is built from it, and it must not become a dead link the moment
// the create syncs and the server assigns its own.
//
// The order is the whole content of this module. `clientVisitId` is client
// input: a device (or a rep who edits what their device sends) can mint one
// equal to another visit's real server id. Resolved as a single
// `OR: [{ id }, { clientVisitId }]`, that lets `findFirst` return either
// matching row indeterminately — a manager opening a visit by its real id could
// be served the impostor. Two queries with the server id tried first make a
// real id always win, and cost nothing extra in the ordinary case, where the
// first one matches.
//
// Every caller keeps its own `select`/`include` by passing the query in, so
// this stays the rule and nothing else.

export type VisitIdentityWhere = {
  tenantId: string;
  id?: string;
  clientVisitId?: string;
};

export async function findVisitByEitherId<TVisit>(
  runQuery: (where: VisitIdentityWhere) => Promise<TVisit | null>,
  tenantId: string,
  visitId: string,
): Promise<TVisit | null> {
  const byServerId = await runQuery({ tenantId, id: visitId });

  if (byServerId) {
    return byServerId;
  }

  return runQuery({ tenantId, clientVisitId: visitId });
}
