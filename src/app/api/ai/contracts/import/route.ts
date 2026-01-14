import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ConfidenceLevel = "alto" | "medio" | "bajo";

type AiContractImportResponse = {
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

const emptyResponse = (warnings?: string[]): AiContractImportResponse => ({
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

type ParsedPdf = { text: string; pages?: number };

const ensureDomMatrix = async () => {
  if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === "undefined") {
    const mod = await import("dommatrix");
    const DOMMatrixCtor =
      (mod as { DOMMatrix?: unknown }).DOMMatrix ??
      (mod as { default?: unknown }).default;
    if (DOMMatrixCtor) {
      (globalThis as { DOMMatrix?: unknown }).DOMMatrix = DOMMatrixCtor;
    }
  }
};

const parsePdfText = async (buffer: Buffer): Promise<ParsedPdf> => {
  await ensureDomMatrix();
  const mod = await import("pdf-parse");
  const pdfParse = mod as unknown as (
    b: Buffer
  ) => Promise<{ text?: string; numpages?: number }>;
  const parsed = await pdfParse(buffer);
  return {
    text: typeof parsed?.text === "string" ? parsed.text : "",
    pages: typeof parsed?.numpages === "number" ? parsed.numpages : undefined,
  };
};

const buildPrompt = (text: string) => `
Extrae datos de un contrato de alquiler. Devuelve SOLO JSON valido sin comentarios.
Campos obligatorios: owner.fullName, tenant.fullName, property.address, dates.startDate, dates.endDate, rent.amount, rent.currency, rent.dueDay.
Si no hay datos, deja string vacio o null.
Formato fecha: YYYY-MM-DD.
Texto:
${text.slice(0, 12000)}
`;

const parseJsonPayload = (content: string) => {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();
  return withoutFence;
};

const safeJsonParse = (payload: string) => {
  try {
    return { ok: true as const, value: JSON.parse(payload) as AiContractImportResponse };
  } catch {
    return { ok: false as const };
  }
};

const parseAiResponse = (content: string) => {
  const trimmed = content.trim();
  const direct = safeJsonParse(trimmed);
  if (direct.ok) {
    return { value: direct.value };
  }
  const withoutFence = parseJsonPayload(content);
  const fenceParsed = safeJsonParse(withoutFence);
  if (fenceParsed.ok) {
    return { value: fenceParsed.value };
  }
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const extracted = safeJsonParse(withoutFence.slice(start, end + 1));
    if (extracted.ok) {
      return { value: extracted.value };
    }
  }
  return { previewSafe: withoutFence.slice(0, 300) };
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
          error: "ai_import_failed",
          code: "bad_request",
          stage,
          detailsSafe: { message: "missing_file" },
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
          error: "ai_import_failed",
          code: "pdf_parse_failed",
          stage,
          detailsSafe: { mime, size, name, message },
        },
        { status: 500 }
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
          error: "ai_import_failed",
          code: "empty_pdf_text",
          stage,
          detailsSafe: { mime, size, name },
        },
        { status: 422 }
      );
    }

    stage = "gemini_call";
    const apiKey = process.env.GEMINI_API_KEY;
    modelName = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
    if (!apiKey) {
      console.error(
        "[AI_IMPORT]",
        JSON.stringify({ stage, mime, size, modelName, pages })
      );
      return NextResponse.json(
        {
          error: "ai_import_failed",
          code: "missing_secret",
          stage,
          detailsSafe: { mime, size, name, message: "missing_gemini_key" },
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`gemini_error: ${response.status} ${message}`);
    }

    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    stage = "json_parse";
    const parsed = parseAiResponse(content);
    if (!("value" in parsed)) {
      previewSafe = parsed.previewSafe;
      console.error(
        "[AI_IMPORT]",
        JSON.stringify({
          stage,
          mime,
          size,
          modelName,
          pages,
          previewSafe: parsed.previewSafe,
        })
      );
      return NextResponse.json(
        {
          error: "ai_import_failed",
          code: "json_parse_failed",
          stage,
          detailsSafe: { mime, size, name, message: "invalid_json" },
        },
        { status: 500 }
      );
    }

    stage = "response";
    return NextResponse.json(parsed.value);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const detailsSafe = {
      mime,
      size,
      name,
      message: message.slice(0, 300),
    };
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
    return NextResponse.json(
      { error: "ai_import_failed", code, stage, detailsSafe },
      { status: 500 }
    );
  }
}
