# QA Regresión - RentaOK

## Alcance
Checklist corto para validar flujos críticos end-to-end (roles, contratos, servicios y pagos).
Se ejecuta antes de cada deploy y despues de cambios críticos o fixes urgentes.
Regla: si falla cualquier ítem crítico (Auth, Roles o Servicios), NO se deploya.

## Pre-requisitos
- 1 usuario owner
- 1 usuario manager u operator
- 1 tenant con:
  - 1 contrato
  - servicios generados (o un período sin servicios para test empty)
- Usar ventana incógnito para evitar cache

## Checklist de Regresión

1) Autenticacion
- [ ] Login con usuario valido  
      Resultado esperado: acceso correcto al dashboard
- [ ] Logout  
      Resultado esperado: sesion finaliza y vuelve a login
- [ ] Persistencia de sesion (refresh)  
      Resultado esperado: se mantiene la sesion y el contexto
- [ ] Usuario sin tenantId  
      Resultado esperado: redirige a onboarding

2) Roles (UI)
- [ ] Owner: ve contratos  
      Resultado esperado: lista de contratos visible
- [ ] Owner: ve tab Servicios  
      Resultado esperado: tab visible y accesible
- [ ] Owner: NO ve boton Editar  
      Resultado esperado: boton Editar no se muestra
- [ ] Manager/Operator: ve boton Editar  
      Resultado esperado: boton Editar visible
- [ ] Manager/Operator: puede guardar cambios  
      Resultado esperado: cambios guardados
- [ ] Manager/Operator: ve toast de éxito  
      Resultado esperado: toast de confirmacion visible
- [ ] Status paid bloquea importe  
      Resultado esperado: campo importe bloqueado

3) Servicios
- [ ] Cambio de período YYYY-MM  
      Resultado esperado: período cambia y carga la lista
- [ ] Período con datos  
      Resultado esperado: lista con servicios
- [ ] Período sin datos  
      Resultado esperado: empty state correcto
- [ ] Editar servicio: cambiar estado  
      Resultado esperado: estado actualizado
- [ ] Editar servicio: cambiar importe  
      Resultado esperado: importe actualizado
- [ ] Editar servicio: vaciar importe  
      Resultado esperado: importe queda vacio
- [ ] Subir comprobante  
      Resultado esperado: archivo subido y asociado
- [ ] Descargar comprobante si existe  
      Resultado esperado: descarga correcta

4) Pagos (si existe UI activa)
- [ ] Pantalla carga sin crash  
      Resultado esperado: vista renderiza sin errores
- [ ] Registrar/editar pago (si esta disponible)  
      Resultado esperado: pago guardado
- [ ] Subir comprobante  
      Resultado esperado: comprobante subido
- [ ] Estados vacios claros  
      Resultado esperado: empty state entendible

5) Documentos / Alertas / Actividad
- [ ] Las tabs cargan sin error  
      Resultado esperado: contenido visible sin fallas
- [ ] Estados vacios legibles  
      Resultado esperado: mensajes claros
- [ ] No hay pantallas en blanco  
      Resultado esperado: siempre hay contenido o mensaje

6) Seguridad minima (regresion)
- [ ] Owner intenta editar  
      Resultado esperado: UI no lo permite
- [ ] Acceso a contrato de otro tenant  
      Resultado esperado: falla o redirige
- [ ] Errores de permisos muestran mensaje humano (si aplica)  
      Resultado esperado: mensaje claro

## Smoke Test Post-Deploy
- [ ] Login  
      Resultado esperado: acceso correcto
- [ ] Abrir contrato  
      Resultado esperado: contrato visible
- [ ] Servicios: listar + editar  
      Resultado esperado: lista y edicion funcionan
- [ ] Pagos: abrir  
      Resultado esperado: pantalla carga
- [ ] Logout  
      Resultado esperado: sesion finaliza

## Registro de ejecucion
Fecha:
Commit:
Tester:
Resultado general: OK / NO OK
Observaciones:
