import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ConfidenceLevel = "alto" | "medio" | "bajo";

type ContractDraft = {
  contract: {
    owner: { fullName: string; dni?: string; phone?: string; email?: string };
    tenant: { fullName: string; dni?: string; phone?: string; email?: string };
    property: {
      address: string;
      unit?: string;
      city?: string;
      province?: string;
    };
    dates: { startDate: string; endDate: string };
    rent: { amount: number | null; currency: string; dueDay?: number | null };
    deposit?: { amount?: number | null; currency?: string };
    guarantee: {
      type: "GARANTES" | "CAUCION" | "CONVENIO_DESALOJO" | "OTRO";
      details?: string;
    };
  };
  confidence: {
    owner: ConfidenceLevel;
    tenant: ConfidenceLevel;
    property: ConfidenceLevel;
    dates: ConfidenceLevel;
    rent: ConfidenceLevel;
    deposit: ConfidenceLevel;
    guarantee: ConfidenceLevel;
  };
  warnings?: string[];
};

type AiImportOkResponse = {
  ok: true;
  draft: ContractDraft;
};

type AiImportErrorResponse = {
  ok: false;
  code: string;
  message: string;
};

const emptyDraft = (warnings?: string[]): ContractDraft => ({
  contract: {
    owner: { fullName: "" },
    tenant: { fullName: "" },
    property: { address: "" },
    dates: { startDate: "", endDate: "" },
    rent: { amount: null, currency: "ARS", dueDay: null },
    deposit: { amount: null, currency: "ARS" },
    guarantee: { type: "OTRO" },
  },
  confidence: {
    owner: "bajo",
    tenant: "bajo",
    property: "bajo",
    dates: "bajo",
    rent: "bajo",
    deposit: "bajo",
    guarantee: "bajo",
  },
  ...(warnings ? { warnings } : {}),
});

const normalizeDraft = (value?: Partial<ContractDraft> | null): ContractDraft => {
  const contract = value?.contract ?? ({} as Partial<ContractDraft["contract"]>);
  const owner = contract.owner ?? ({} as Partial<ContractDraft["contract"]["owner"]>);
  const tenant = contract.tenant ?? ({} as Partial<ContractDraft["contract"]["tenant"]>);
  const property = contract.property ?? ({} as Partial<ContractDraft["contract"]["property"]>);
  const dates = contract.dates ?? ({} as Partial<ContractDraft["contract"]["dates"]>);
  const rent = contract.rent ?? ({} as Partial<ContractDraft["contract"]["rent"]>);
  const deposit = (contract.deposit ?? {}) as { amount?: number | null; currency?: string };
  const guarantee =
    contract.guarantee ?? ({} as Partial<ContractDraft["contract"]["guarantee"]>);
  const confidence = value?.confidence ?? ({} as Partial<ContractDraft["confidence"]>);
  return {
    contract: {
      owner: {
        fullName: owner.fullName ?? "",
        dni: owner.dni ?? "",
        phone: owner.phone ?? "",
        email: owner.email ?? "",
      },
      tenant: {
        fullName: tenant.fullName ?? "",
        dni: tenant.dni ?? "",
        phone: tenant.phone ?? "",
        email: tenant.email ?? "",
      },
      property: {
        address: property.address ?? "",
        unit: property.unit ?? "",
        city: property.city ?? "",
        province: property.province ?? "",
      },
      dates: {
        startDate: dates.startDate ?? "",
        endDate: dates.endDate ?? "",
      },
      rent: {
        amount: rent.amount !== null && rent.amount !== undefined ? rent.amount : null,
        currency: rent.currency ?? "ARS",
        dueDay: rent.dueDay ?? null,
      },
      deposit: {
        amount:
          deposit.amount !== null && deposit.amount !== undefined ? deposit.amount : null,
        currency: deposit.currency ?? "ARS",
      },
      guarantee: {
        type: guarantee.type ?? "OTRO",
        details: guarantee.details,
      },
    },
    confidence: {
      owner: confidence.owner ?? "bajo",
      tenant: confidence.tenant ?? "bajo",
      property: confidence.property ?? "bajo",
      dates: confidence.dates ?? "bajo",
      rent: confidence.rent ?? "bajo",
      deposit: confidence.deposit ?? "bajo",
      guarantee: confidence.guarantee ?? "bajo",
    },
    warnings: value?.warnings,
  };
};

type ParsedPdf = { text: string; pages?: number };

const parsePdfText = async (buffer: Buffer): Promise<ParsedPdf> => {
  if (typeof (globalThis as { navigator?: unknown }).navigator === "undefined") {
    (globalThis as { navigator?: { userAgent: string } }).navigator = {
      userAgent: "node",
    };
  }
  const mod = await import("pdfreader");
  const PdfReaderCtor = mod.PdfReader as new () => {
    parseBuffer: (
      data: Buffer,
      cb: (err: Error | null, item: { text?: string; page?: number } | null) => void
    ) => void;
  };
  const textChunks: string[] = [];
  let maxPage = 0;
  await new Promise<void>((resolve, reject) => {
    new PdfReaderCtor().parseBuffer(buffer, (err, item) => {
      if (err) {
        reject(err);
        return;
      }
      if (!item) {
        resolve();
        return;
      }
      if (typeof item.page === "number") {
        maxPage = Math.max(maxPage, item.page);
        return;
      }
      if (typeof item.text === "string") {
        textChunks.push(item.text);
      }
    });
  });
  const parsed = {
    text: textChunks.join("\n"),
    numpages: maxPage,
  };
  return {
    text: typeof parsed?.text === "string" ? parsed.text : "",
    pages: typeof parsed?.numpages === "number" ? parsed.numpages : undefined,
  };
};

const buildPrompt = (text: string) => `
Extrae datos de un contrato de alquiler.
Devuelve SOLO un bloque JSON entre los marcadores:
BEGIN_JSON
{ ... }
END_JSON
No agregues texto fuera de BEGIN_JSON/END_JSON.
Formato fecha: YYYY-MM-DD.
Campos obligatorios: contract.owner.fullName, contract.tenant.fullName, contract.property.address, contract.dates.startDate, contract.dates.endDate, contract.rent.amount, contract.rent.currency, contract.rent.dueDay.
Si no hay datos, deja string vacio o null.
Estructura exacta:
BEGIN_JSON
{
  "contract": {
    "owner": { "fullName": "", "dni": "", "phone": "", "email": "" },
    "tenant": { "fullName": "", "dni": "", "phone": "", "email": "" },
    "property": { "address": "", "unit": "", "city": "", "province": "" },
    "dates": { "startDate": "", "endDate": "" },
    "rent": { "amount": null, "currency": "ARS", "dueDay": null },
    "deposit": { "amount": null, "currency": "ARS" },
    "guarantee": { "type": "GARANTES|CAUCION|CONVENIO_DESALOJO|OTRO", "details": "" }
  },
  "confidence": {
    "owner": "alto|medio|bajo",
    "tenant": "alto|medio|bajo",
    "property": "alto|medio|bajo",
    "dates": "alto|medio|bajo",
    "rent": "alto|medio|bajo",
    "deposit": "alto|medio|bajo",
    "guarantee": "alto|medio|bajo"
  },
  "warnings": []
}
END_JSON
Texto:
${text.slice(0, 12000)}
`;

const buildRepairPrompt = (content: string) => `
Repara el siguiente contenido para que sea SOLO JSON valido dentro de:
BEGIN_JSON
{ ... }
END_JSON
No agregues texto fuera de BEGIN_JSON/END_JSON.
Contenido:
${content.slice(0, 8000)}
`;

const extractJsonBlock = (content: string) => {
  const start = content.indexOf("BEGIN_JSON");
  const end = content.indexOf("END_JSON");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return content.slice(start + "BEGIN_JSON".length, end).trim();
};

const safeJsonParse = (payload: string) => {
  try {
    return { ok: true as const, value: JSON.parse(payload) as ContractDraft };
  } catch {
    return { ok: false as const };
  }
};

type Stage =
  | "request"
  | "read_form"
  | "read_file"
  | "pdf_parse"
  | "gemini_call"
  | "json_parse"
  | "response";

export async function POST(req: Request) {
  let stage: Stage = "request";
  let mime: string | undefined;
  let size: number | undefined;
  let name: string | undefined;
  let modelName: string | undefined;
  let pages: number | undefined;
  let inputLength: number | undefined;
  let inputLengthUsed: number | undefined;
  let previewSafe: string | undefined;
  let fallbackUsed = false;

  try {
    stage = "read_form";
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      console.error(
        "[AI_IMPORT]",
        JSON.stringify({ stage, mime, size, modelName, pages })
      );
      return NextResponse.json(
        {
          ok: false,
          code: "bad_request",
          message: "No pudimos leer el archivo.",
        },
        { status: 400 }
      );
    }
    stage = "read_file";

    mime = file.type || undefined;
    size = file.size || undefined;
    name = file.name || undefined;

    stage = "pdf_parse";
    const buffer = Buffer.from(await file.arrayBuffer());
    let parsedPdf: ParsedPdf;
    try {
      parsedPdf = await parsePdfText(buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error && err.stack ? err.stack : undefined;
      const detailsSafe = {
        name,
        message,
        stack: stack ? stack.slice(0, 1800) : undefined,
      };
      console.error(
        "[AI_IMPORT]",
        JSON.stringify({
          stage,
          mime,
          size,
          name,
          detailsSafe,
        })
      );
      return NextResponse.json(
        {
          ok: false,
          code: "pdf_parse_failed",
          message: "No pudimos leer el PDF. Probá otro archivo.",
        },
        { status: 422 }
      );
    }
    const text = parsedPdf.text;
    pages = parsedPdf.pages;
    if (!text.trim()) {
      console.error(
        "[AI_IMPORT]",
        JSON.stringify({ stage, mime, size, modelName, pages })
      );
      return NextResponse.json(
        {
          ok: false,
          code: "empty_pdf_text",
          message: "No pudimos extraer texto del PDF.",
        },
        { status: 422 }
      );
    }

    stage = "gemini_call";
    const apiKey = process.env.GEMINI_API_KEY;
    const apiVersion = process.env.GEMINI_API_VERSION?.trim() || "v1";
    const fallbackModel = "gemini-1.5-flash-latest";
    const preferredModel = process.env.GEMINI_MODEL?.trim() || fallbackModel;
    modelName = preferredModel;
    if (!apiKey) {
      console.error(
        "[AI_IMPORT]",
        JSON.stringify({ stage, mime, size, modelName, pages })
      );
      return NextResponse.json(
        {
          ok: false,
          code: "missing_secret",
          message: "Falta configurar la integracion de IA.",
        },
        { status: 500 }
      );
    }

    inputLength = text.length;
    const MAX_CHARS = 120_000;
    const textUsed = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
    inputLengthUsed = textUsed.length;
    const payload = {
      contents: [
        {
          role: "user",
          parts: [{ text: buildPrompt(textUsed) }],
        },
      ],
      generationConfig: { temperature: 0 },
    };

    const callGemini = async (model: string, body: unknown) => {
      const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${apiKey}`;
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    };

    let response = await callGemini(modelName, payload);
    if (response.status === 404 && modelName !== fallbackModel) {
      fallbackUsed = true;
      modelName = fallbackModel;
      response = await callGemini(modelName, payload);
    }

    console.error(
      "[AI_IMPORT]",
      JSON.stringify({ stage, mime, size, modelName, pages, fallbackUsed })
    );

    if (!response.ok) {
      const message = await response.text();
      console.error(
        "[AI_IMPORT]",
        JSON.stringify({
          stage,
          mime,
          size,
          modelName,
          pages,
          error: "gemini_error",
          status: response.status,
          message: message.slice(0, 300),
        })
      );
      return NextResponse.json(
        {
          ok: false,
          code: "gemini_error",
          message: "No pudimos procesar el PDF. Probá de nuevo.",
        },
        { status: 200 }
      );
    }

    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    stage = "json_parse";
    const block = extractJsonBlock(content);
    const parsed = block ? safeJsonParse(block) : { ok: false as const };
    if (!parsed.ok) {
      previewSafe = block?.slice(0, 300) ?? content.slice(0, 300);
      const repairPayload = {
        contents: [
          {
            role: "user",
            parts: [{ text: buildRepairPrompt(content) }],
          },
        ],
        generationConfig: { temperature: 0 },
      };
      const repairResponse = await callGemini(modelName, repairPayload);
      if (repairResponse.ok) {
        const repairData = (await repairResponse.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const repairContent = repairData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        const repairBlock = extractJsonBlock(repairContent);
        const repairParsed = repairBlock ? safeJsonParse(repairBlock) : { ok: false as const };
        if (repairParsed.ok) {
          stage = "response";
          const draft = normalizeDraft(repairParsed.value);
          return NextResponse.json({ ok: true, draft } satisfies AiImportOkResponse);
        }
      }

      console.error(
        "[AI_IMPORT] json_parse_failed",
        JSON.stringify({ stage, mime, size, modelName, pages, previewSafe })
      );
      return NextResponse.json(
        {
          ok: false,
          code: "json_parse_failed",
          message: "No pudimos extraer datos del PDF. Probá otro archivo.",
        },
        { status: 200 }
      );
    }

    stage = "response";
    const draft = normalizeDraft(parsed.value);
    return NextResponse.json({ ok: true, draft } satisfies AiImportOkResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (stage === "json_parse") {
      console.error(
        "[AI_IMPORT]",
        JSON.stringify({
          stage,
          mime,
          size,
          modelName,
          pages,
          ...(previewSafe ? { previewSafe } : {}),
        })
      );
    } else if (stage === "gemini_call") {
      console.error(
        "[AI_IMPORT]",
        JSON.stringify({
          stage,
          mime,
          size,
          modelName,
          pages,
          inputLength,
          inputLengthUsed,
          fallbackUsed,
        })
      );
    } else {
      console.error(
        "[AI_IMPORT]",
        JSON.stringify({ stage, mime, size, modelName, pages })
      );
    }
    const code =
      message.startsWith("gemini_error:")
        ? "gemini_error"
        : stage === "json_parse"
          ? "json_parse_failed"
          : "unexpected_error";
    const status = code === "gemini_error" ? 200 : 500;
    return NextResponse.json(
      {
        ok: false,
        code,
        message: "No pudimos procesar el PDF. Probá de nuevo.",
      } satisfies AiImportErrorResponse,
      { status }
    );
  }
}
