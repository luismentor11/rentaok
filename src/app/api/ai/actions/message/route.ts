import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/server/firebaseAdmin";

export const runtime = "nodejs";

type AlertType = "VENCIDA" | "VENCE_HOY" | "PARCIAL" | "EN_ACUERDO" | "SIN_RECIBO";
type MessageTone = "formal" | "neutro" | "corto";

type MessageRequest = {
  type: AlertType;
  contractId: string;
  installmentId?: string;
  tone?: MessageTone;
};

type MessageResponse =
  | { ok: true; subject?: string; body: string }
  | { ok: false; message: string };

const allowedTypes: AlertType[] = [
  "VENCIDA",
  "VENCE_HOY",
  "PARCIAL",
  "EN_ACUERDO",
  "SIN_RECIBO",
];

const formatAmount = (value: number) => {
  if (!Number.isFinite(value)) return null;
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(value);
};

const formatDate = (value?: Date | null) => {
  if (!value || !Number.isFinite(value.getTime())) return null;
  return value.toLocaleDateString("es-AR");
};

const getDueDate = (raw?: unknown) => {
  if (!raw) return null;
  const anyRaw = raw as { toDate?: () => Date };
  if (typeof anyRaw.toDate === "function") {
    return anyRaw.toDate();
  }
  if (raw instanceof Date) return raw;
  return null;
};

const buildSignature = (params: {
  ownerFullName?: string | null;
  tenantName?: string | null;
  tone: MessageTone;
}) => {
  const { ownerFullName, tenantName, tone } = params;
  const name = ownerFullName?.trim() || "";
  const business = tenantName?.trim() || "";
  const signatureName = name && business ? `${name} · ${business}` : name || business;
  const closing = tone === "formal" ? "Saludos cordiales" : "Gracias";
  return signatureName ? `${closing}\n${signatureName}` : closing;
};

const buildTemplate = (params: {
  type: AlertType;
  tone: MessageTone;
  tenantFullName?: string | null;
  ownerFullName?: string | null;
  tenantName?: string | null;
  propertyLabel?: string | null;
  period?: string | null;
  dueDate?: Date | null;
  dueAmount?: number | null;
}) => {
  const {
    type,
    tone,
    tenantFullName,
    ownerFullName,
    tenantName,
    propertyLabel,
    period,
    dueDate,
    dueAmount,
  } = params;
  const greeting =
    tone === "formal"
      ? `Estimado/a ${tenantFullName?.trim() || "locatario/a"}`
      : `Hola ${tenantFullName?.trim() || ""}`.trim();
  const place = propertyLabel?.trim();
  const periodLabel = period?.trim();
  const dueDateLabel = formatDate(dueDate);
  const dueAmountLabel =
    dueAmount !== null && dueAmount !== undefined ? formatAmount(dueAmount) : null;
  const reference = [place, periodLabel].filter(Boolean).join(" - ");
  const signature = buildSignature({ ownerFullName, tenantName, tone });

  const baseIntro = reference
    ? `Te escribo por el alquiler ${reference}.`
    : "Te escribo por el alquiler pendiente.";

  const detailParts = [
    dueDateLabel ? `Vencimiento: ${dueDateLabel}.` : null,
    dueAmountLabel ? `Saldo pendiente: ${dueAmountLabel}.` : null,
  ].filter(Boolean);

  const details = detailParts.length > 0 ? ` ${detailParts.join(" ")}` : "";

  const toneAsk =
    tone === "corto"
      ? "Avísame para coordinar el pago."
      : tone === "formal"
        ? "Agradezco confirmar cuando puedas regularizarlo."
        : "Avisame para coordinar el pago.";

  const baseLines = [greeting, "", `${baseIntro}${details}`, toneAsk, "", signature];

  switch (type) {
    case "VENCE_HOY": {
      const intro = reference
        ? `Hoy vence el alquiler ${reference}.`
        : "Hoy vence el alquiler.";
      const ask =
        tone === "formal"
          ? "Agradezco confirmar el pago en el dia."
          : "Si ya lo abonaste, avisame.";
      return [greeting, "", `${intro}${details}`, ask, "", signature].join("\n");
    }
    case "VENCIDA": {
      return baseLines.join("\n");
    }
    case "PARCIAL": {
      const intro = reference
        ? `Tenemos registrado un pago parcial del alquiler ${reference}.`
        : "Tenemos registrado un pago parcial del alquiler.";
      const ask =
        tone === "formal"
          ? "Quedo atento/a a la regularizacion del saldo."
          : "Avisame para completar el saldo.";
      return [greeting, "", `${intro}${details}`, ask, "", signature].join("\n");
    }
    case "EN_ACUERDO": {
      const intro = reference
        ? `El alquiler ${reference} sigue en acuerdo de pago.`
        : "El alquiler sigue en acuerdo de pago.";
      const ask =
        tone === "formal"
          ? "Agradezco confirmar el estado del acuerdo."
          : "Avisame como seguimos con el acuerdo.";
      return [greeting, "", `${intro}${details}`, ask, "", signature].join("\n");
    }
    case "SIN_RECIBO": {
      const intro = reference
        ? `Registramos un pago del alquiler ${reference} sin comprobante.`
        : "Registramos un pago sin comprobante.";
      const ask =
        tone === "formal"
          ? "Si tenes el comprobante, agradezco enviarlo."
          : "Si tenes el comprobante, pasamelo por favor.";
      return [greeting, "", `${intro}${details}`, ask, "", signature].join("\n");
    }
    default:
      return baseLines.join("\n");
  }
};

const buildRewritePrompt = (body: string, tone: MessageTone) => {
  const toneLabel =
    tone === "corto" ? "corto y directo" : tone === "formal" ? "formal" : "neutro";
  return `
Reescribe el siguiente mensaje en español con tono ${toneLabel}.
Mantene el contenido y los datos. No inventes informacion. No agregues datos sensibles.
Devolve solo el texto final, sin comillas ni explicaciones.
Mensaje:
${body}
`.trim();
};

const rewriteWithGemini = async (body: string, tone: MessageTone) => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const apiVersion = process.env.GEMINI_API_VERSION?.trim() || "v1";
  const fallbackModel = "gemini-1.5-flash-latest";
  const preferredModel = process.env.GEMINI_MODEL?.trim() || fallbackModel;
  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: buildRewritePrompt(body, tone) }],
      },
    ],
    generationConfig: { temperature: 0.2 },
  };

  const callGemini = async (model: string) => {
    const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${apiKey}`;
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  };

  let modelName = preferredModel;
  let response = await callGemini(modelName);
  if (response.status === 404 && modelName !== fallbackModel) {
    modelName = fallbackModel;
    response = await callGemini(modelName);
  }

  if (!response.ok) {
    const message = await response.text();
    console.error(
      "[AI_MESSAGE] gemini_error",
      JSON.stringify({ status: response.status, message: message.slice(0, 200) })
    );
    return null;
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  return content || null;
};

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as Partial<MessageRequest>;
    const type = payload.type;
    if (!type || !allowedTypes.includes(type)) {
      return NextResponse.json(
        { ok: false, message: "No pudimos generar el mensaje." } satisfies MessageResponse,
        { status: 200 }
      );
    }
    const contractId = typeof payload.contractId === "string" ? payload.contractId : "";
    if (!contractId.trim()) {
      return NextResponse.json(
        { ok: false, message: "No pudimos generar el mensaje." } satisfies MessageResponse,
        { status: 200 }
      );
    }
    const tone: MessageTone =
      payload.tone === "formal" || payload.tone === "corto" ? payload.tone : "neutro";

    const authHeader = req.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return NextResponse.json(
        { ok: false, message: "No pudimos generar el mensaje." } satisfies MessageResponse,
        { status: 200 }
      );
    }

    let tenantId: string | null = null;
    try {
      const decoded = await getAdminAuth().verifyIdToken(match[1]);
      tenantId =
        typeof (decoded as { tenantId?: unknown }).tenantId === "string"
          ? ((decoded as { tenantId?: string }).tenantId as string)
          : null;
    } catch (err) {
      console.error("[AI_MESSAGE] auth_failed", err);
      return NextResponse.json(
        { ok: false, message: "No pudimos generar el mensaje." } satisfies MessageResponse,
        { status: 200 }
      );
    }

    if (!tenantId || typeof tenantId !== "string") {
      return NextResponse.json(
        { ok: false, message: "missing_tenant_claim" } satisfies MessageResponse,
        { status: 403 }
      );
    }

    const contractSnap = await getAdminDb()
      .doc(`tenants/${tenantId}/contracts/${contractId}`)
      .get();
    const contractData = contractSnap.exists ? (contractSnap.data() as any) : null;

    const installmentId =
      typeof payload.installmentId === "string" ? payload.installmentId : null;
    let installmentData: any = null;
    if (installmentId) {
      const installmentSnap = await getAdminDb()
        .doc(`tenants/${tenantId}/installments/${installmentId}`)
        .get();
      installmentData = installmentSnap.exists ? installmentSnap.data() : null;
    }

    const tenantFullName = contractData?.parties?.tenant?.fullName ?? null;
    const ownerFullName = contractData?.parties?.owner?.fullName ?? null;
    const tenantName = contractData?.tenantName ?? null;
    const propertyLabel =
      contractData?.property?.title ?? contractData?.property?.address ?? null;
    const period = installmentData?.period ?? null;
    const dueDate = getDueDate(installmentData?.dueDate);
    const dueAmountRaw = installmentData?.totals?.due;
    const dueAmount =
      typeof dueAmountRaw === "number" && Number.isFinite(dueAmountRaw)
        ? dueAmountRaw
        : null;

    const baseBody = buildTemplate({
      type,
      tone,
      tenantFullName,
      ownerFullName,
      tenantName,
      propertyLabel,
      period,
      dueDate,
      dueAmount,
    });

    let body = baseBody;
    try {
      const rewritten = await rewriteWithGemini(baseBody, tone);
      if (rewritten) {
        body = rewritten;
      }
    } catch (err) {
      console.error("[AI_MESSAGE] gemini_exception", err);
    }

    return NextResponse.json({ ok: true, body } satisfies MessageResponse);
  } catch (err) {
    console.error("[AI_MESSAGE] unexpected_error", err);
    return NextResponse.json(
      { ok: false, message: "No pudimos generar el mensaje." } satisfies MessageResponse,
      { status: 200 }
    );
  }
}
