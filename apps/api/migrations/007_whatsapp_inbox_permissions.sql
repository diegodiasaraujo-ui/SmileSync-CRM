BEGIN;

INSERT INTO permissions (code, description, sensitivity) VALUES
  ('whatsapp.inbox.read', 'Consultar conversas e mensagens do WhatsApp', 'clinical'),
  ('whatsapp.inbox.send', 'Enviar mensagens pelo WhatsApp', 'clinical')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (clinic_id, role_id, permission_code)
SELECT roles.clinic_id, roles.id, permissions.code
FROM roles
CROSS JOIN permissions
WHERE roles.is_system AND roles.code = 'administrador'
  AND permissions.code IN ('whatsapp.inbox.read', 'whatsapp.inbox.send')
ON CONFLICT DO NOTHING;

COMMIT;
