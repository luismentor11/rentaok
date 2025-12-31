# RENTAOK V1 PLAN

Reglas no negociables
- Notificaciones solo al inquilino
- Mora manual como item, nunca automatica
- Pagos parciales + "pagado sin comprobante"
- Garantes siempre como datos, sin notificacion automatica v1
- Export ZIP obligatorio
- Auth client-only

Etapa 1 - Contratos MVP + PDF
- Commits chicos:
  - feat: contracts MVP with required guarantors and pdf upload
- Checkpoints verificables:
  - /contracts lista
  - /contracts/new permite crear contrato con garantes + PDF
  - /contracts/[id] muestra datos del contrato y link de PDF
  - build/dev no roto

Etapa 2 - Cuotas (installments) y generacion mensual
- Commits chicos:
  - feat: generate monthly installments from contract
- Checkpoints verificables:
  - Abrir contrato -> tab Cuotas -> click Generar cuotas
  - Se crean cuotas mensuales y se listan
  - Repetir click no duplica (id estable)

### QA Manual (Checklist)

- Crear un contrato con startDate, endDate, dueDay y rentAmount.
- Ir a Contract Detail → Tab “Cuotas”.
- Click en “Generar cuotas”.
- Verificar en Firestore que se crearon docs en:
  tenants/{tenantId}/installments
  con IDs: {contractId}_YYYY-MM
- Verificar para cada cuota:
  - period correcto ("YYYY-MM")
  - dueDate correcto (clamp al último día del mes si dueDay excede)
  - totals iniciales: total = rentAmount, paid = 0, due = total
  - status correcto según hoy: POR_VENCER / VENCE_HOY / VENCIDA
  - subcolección items contiene 1 item base:
    - type = ALQUILER
    - label = "Alquiler"
    - amount = rentAmount
- Click en “Generar cuotas” nuevamente:
  - NO duplica cuotas (idempotencia por existencia del doc)
  - NO duplica items (no se crean items si la cuota ya existía)

Etapa 3 - Pagos basicos e items manuales
- Commits chicos:
  - feat: add payments collection scaffolding
  - feat: record partial payments and mark paid without receipt
- Checkpoints verificables:
  - Registrar pago parcial en una cuota y ver total/due actualizado
  - Marcar cuota como "pagado sin comprobante"
  - Mora solo como item manual, nunca automatico

QA Manual (Checklist) - Commit 3.1
- Generar cuotas
- Registrar pago parcial (ej 1000) => status PARCIAL, paid incrementa, due baja
- Registrar otro pago que complete => status PAGADA, due 0
- Registrar pago con "sin comprobante" => paymentFlags.hasUnverifiedPayments true + badge visible
- Verificar en Firestore que existe payment en /payments

QA Manual (Checklist) - Commit 3.2
- En una cuota:
  - Agregar EXPENSAS 20000 => totals.total sube, due sube
  - Agregar DESCUENTO -5000 => totals.total baja, due baja
  - Borrar EXPENSAS => totals vuelve
- Si cuota ya tiene paid parcial:
  - Agregar item => due se recalcula (no tocar paid)
- Validar que status:
  - paid == 0 => POR_VENCER / VENCE_HOY / VENCIDA
  - paid > 0 && paid < total => PARCIAL
  - paid >= total => PAGADA

QA Manual (Checklist) - Commit 3.3
- En una cuota con due > 0:
  - Click "Marcar pagada (sin comprobante)"
  - Ver status PAGADA, due 0, paid == total, badge visible
  - Ver payment doc creado en /payments con withoutReceipt=true
- En una cuota:
  - Agregar mora 3000
  - Ver totals.total aumenta y due aumenta si no esta pagada
  - Ver item creado en /items con label "Mora"

### QA Manual (Checklist) - Pagos v1

- Registrar pago con EFECTIVO + fecha default -> payment doc incluye method/paidAt/collectedBy
- Registrar pago con TRANSFERENCIA + nota -> nota presente
- Registrar pago con comprobante (archivo) -> receipt guardado con url/path y archivo existe en Storage
- Registrar pago "Sin comprobante" -> receipt no existe, flag true
- Totals/status se actualizan como antes

### QA Manual (Checklist) - Bitacora v1

- Crear evento RECLAMO con tags y fecha -> aparece en lista
- Subir 1-2 adjuntos -> links funcionan, archivos existen en Storage
- Asociar a una cuota (si implementado) -> se guarda installmentId
- Verificar createdBy = uid

Etapa 4 - Notificaciones v1 (solo inquilino)
- Commits chicos:
  - feat: tenant-only notification config and overrides
  - feat: notification preview and opt-in per installment
- Checkpoints verificables:
  - Configuracion de notificaciones solo al inquilino
  - Overrides por cuota respetados

QA Manual (Checklist) - Etapa 4.1
- Activar notificaciones en contrato:
  - recipients se setean SOLO a tenant.email/tenant.whatsapp (si existen)
- En cuotas:
  - override OFF para una cuota -> se guarda notificationOverride.enabled=false
  - volver a heredar -> se elimina notificationOverride
- No hay recipients manuales.

QA Manual (Checklist) - Etapa 4.2
- Setear un contrato con cuotas y enabled=true.
- Forzar fechas (temporal) o probar con una cuota que caiga en:
  - hoy = dueDate - 5 dias
  - hoy = dueDate + 1 dia (si no PAGADA)
- Confirmar que:
  - aparecen en "Para enviar hoy"
  - respetan override OFF
  - botones abren wa.me y mailto correctos (texto correcto)
- Si cuota PAGADA -> no aparece.

QA Manual (Checklist) - Etapa 5.1
- Config enabled=true
- Cuota con dueDate = hoy - 5 dias y status VENCIDA => aparece en seccion garantes
- Si status EN_ACUERDO => NO aparece
- Si status PAGADA => NO aparece
- Verificar que el mensaje a garante NO contiene importes
- Verificar que botones abren wa.me/mailto para cada garante

QA Manual (Checklist) - Etapa 5.2
- En "Para enviar hoy", click WhatsApp (tenant):
  - se crea notificationLog entry
  - boton queda "Ya enviado hoy"
  - refrescar pagina: sigue "Ya enviado"
- Repetir para email (otro canal): debe permitir porque channel distinto
- Garantes: click WhatsApp en garante 1 => solo ese queda "Ya enviado"; garante 2 sigue habilitado.
- Confirmar que el log NO contiene montos ni texto.

Etapa 5 - Export ZIP obligatorio
- Commits chicos:
  - feat: export ZIP with contract + installments
- Checkpoints verificables:
  - Export ZIP disponible en detalle de contrato
  - ZIP incluye contrato PDF y resumen de cuotas

Etapa 6 - Hardening y QA
- Commits chicos:
  - chore: validate invariants and edge cases
  - chore: UI polish for installments and contracts
- Checkpoints verificables:
  - Flujos principales sin errores en dev
  - Reglas no negociables verificadas
