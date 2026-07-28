-- WINDTUNNEL fixture enrichment: realistic business + services so answer/act
-- tasks have real content (names, durations, prices) instead of the installer's
-- single placeholder "Service". Runs once after `console install`, before the
-- reset dump is captured. Deterministic — no random values.

UPDATE ea_settings SET value = 'Riverside Wellness Studio' WHERE name = 'company_name';

UPDATE ea_services
SET name = 'Consultation', duration = 30, price = 0.00, currency = 'USD',
    description = 'Free 30-minute intake consultation for new clients.'
WHERE id = 1;

INSERT INTO ea_services (name, duration, price, currency, description, slot_interval, attendants_number, is_private)
VALUES
  ('Haircut', 45, 35.00, 'USD', 'Wash, cut and style with one of our stylists.', 15, 1, 0),
  ('Deep Tissue Massage', 60, 90.00, 'USD', 'Focused 60-minute deep tissue massage.', 15, 1, 0);

-- Link the new services to the existing provider (Jane Doe, user id 2).
INSERT INTO ea_services_providers (id_users, id_services)
SELECT 2, s.id FROM ea_services s WHERE s.name IN ('Haircut', 'Deep Tissue Massage');
