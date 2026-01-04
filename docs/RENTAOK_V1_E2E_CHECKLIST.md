# RentaOK v1 E2E Checklist

## Preconditions
- Usuario nuevo (email no registrado).
- Tenant nuevo (sin datos previos).

## Datos de prueba sugeridos
- Email: qa+rentaok@example.com
- Password: Test1234!
- Nombre tenant: Inmobiliaria QA
- Propiedad: "Depto 2 ambientes", "Av. Siempre Viva 123"
- Locatario: "Juan Perez", DNI 30123456, email juan@example.com, WhatsApp +54 11 1234 5678
- Propietario: "Ana Lopez", DNI 28999888, email ana@example.com, WhatsApp +54 11 4444 8888
- Garante: "Maria Gomez", DNI 27111222, domicilio "Calle 9 123", email garante@example.com, WhatsApp +54 11 2222 3333
- Fechas contrato: inicio 2025-02-01, fin 2026-01-31
- Dia vencimiento: 10
- Monto inicial: 250000
- Deposito: 0
- Regla actualizacion: IPC, periodicidad 12

## Pasos (1..9)
1) Registro / Login
   - Paso: Crear cuenta con email y password sugeridos.
   - Resultado esperado: acceso exitoso y redireccion a onboarding.

2) Onboarding tenant
   - Paso: Crear tenant con el nombre sugerido.
   - Resultado esperado: se crea tenant y se redirige al panel operativo.

3) Crear contrato
   - Paso: Ir a Contratos > Nuevo contrato y completar datos (propiedad, partes, garantes, fechas, vencimiento, monto, PDF).
   - Resultado esperado: contrato creado y se abre el detalle del contrato.

4) Generar cuotas
   - Paso: En detalle del contrato, tab Pagos, click "Generar cuotas".
   - Resultado esperado: aparecen cuotas mensuales con estado inicial y totales.

5) Registrar pago parcial
   - Paso: En una cuota, click "Registrar pago" y cargar monto parcial > 0.
   - Resultado esperado: estado "PARCIAL" y totales actualizados.

6) Agregar item adicional
   - Paso: En una cuota, click "Agregar adicional" y cargar concepto y monto > 0.
   - Resultado esperado: item agregado y totales recalculados.

7) Agregar mora
   - Paso: En una cuota, click "Agregar mora" y cargar monto > 0.
   - Resultado esperado: mora agregada como item y totales recalculados.

8) Configuracion
   - Paso: Ir a Configuracion y guardar Datos de la oficina + Recordatorios.
   - Resultado esperado: guardado exitoso sin errores.

9) Registrar actividad manual
   - Paso: En detalle del contrato, tab Actividad, click "Enviar mensaje", completar y registrar.
   - Resultado esperado: mensaje registrado en eventos del contrato.

## Common failures
- Redireccion no ocurre despues de login u onboarding.
- Error al generar cuotas o listado vacio.
- Registro de pago no cambia estado ni totales.
- Configuracion no guarda (permiso o tenantId nulo).
- Mensaje manual no se registra en actividad.

## Notas de observacion
- Fecha:
- Entorno:
- Navegador:
- Observaciones:
