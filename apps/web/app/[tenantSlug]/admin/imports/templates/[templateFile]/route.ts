import { NextResponse } from "next/server";

import {
  buildApiUrl,
  buildRequestHeaders,
} from "../../../../../../lib/api-client";

type TemplateDownloadRouteProps = {
  params: Promise<{
    templateFile: string;
    tenantSlug: string;
  }>;
};

export async function GET(
  _request: Request,
  { params }: TemplateDownloadRouteProps,
) {
  const { templateFile } = await params;
  const response = await fetch(
    buildApiUrl(`/imports/templates/${templateFile}`),
    {
      cache: "no-store",
      headers: await buildRequestHeaders(),
    },
  );
  const body = await response.text();
  const headers = new Headers();

  for (const headerName of ["content-type", "content-disposition"]) {
    const headerValue = response.headers.get(headerName);

    if (headerValue) {
      headers.set(headerName, headerValue);
    }
  }

  if (!response.ok) {
    return NextResponse.json(
      { message: body || `Template download failed with ${response.status}.` },
      { status: response.status },
    );
  }

  return new Response(body, {
    headers,
    status: response.status,
  });
}
