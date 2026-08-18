```javascript
/* ----------------------------------------------------------------------------
 * Easy!Appointments - Online Appointment Scheduler
 *
 * @package     EasyAppointments
 * @author      A.Tselegidis <alextselegidis@gmail.com>
 * @copyright   Copyright (c) Alex Tselegidis
 * @license     https://opensource.org/licenses/GPL-3.0 - GPLv3
 * @link        https://easyappointments.org
 * ---------------------------------------------------------------------------- */

/**
 * WebMCP tool: check_availability.
 *
 * Asks the same two booking routes the wizard itself calls, and drives the wizard's own controls so
 * the visitor ends up looking at the availability the agent just read.
 */

import {defineTool} from '@nekuda/webmcp';
import {
    ANY_PROVIDER,
    findProvider,
    findService,
    getFromSite,
    isManageMode,
    pageVar,
    postToSite,
    requireBookingWizard,
    resolveProviderId,
} from './support.js';
import {selectServiceProviderDate} from './wizard.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const checkAvailability = defineTool({
    stableKey: 'booking.availability.check',
    name: 'check_availability',
    title: 'Check free appointment times',
    description:
        'Check which appointment start times are still free for a service on a given date, and which dates in that ' +
        'month are fully booked. Call this after list_services and before book_appointment so you book a slot that ' +
        'actually exists. It also sets the service, provider and date in the booking form on the page, so the ' +
        "visitor sees the same availability you do. Returns the free start times for that date in the provider's " +
        'timezone, plus the unavailable dates of that month.',
    inputSchema: {
        type: 'object',
        properties: {
            service_id: {
                type: 'integer',
                description: 'The service to check, as returned by list_services.',
            },
            date: {
                type: 'string',
                description: 'The day to check, as YYYY-MM-DD.',
                pattern: '^\\d{4}-\\d{2}-\\d{2}$',
            },
            provider_id: {
                description:
                    'Optional. A specific provider id, or "any-provider" to let the business pick. Defaults to the ' +
                    'first provider who offers the service.',
                anyOf: [{type: 'integer'}, {type: 'string', enum: [ANY_PROVIDER]}],
            },
        },
        required: ['service_id', 'date'],
        additionalProperties: false,
    },
    annotations: {readOnlyHint: true, untrustedContentHint: false},
    async execute({service_id: serviceId, date, provider_id: providerId}) {
        requireBookingWizard();

        if (!DATE_PATTERN.test(date)) {
            throw new Error(`"${date}" is not a date. Pass the day as YYYY-MM-DD.`);
        }

        const service = findService(serviceId);
        const resolvedProviderId = resolveProviderId(serviceId, providerId);
        const manageMode = isManageMode();
        const appointmentId = manageMode ? pageVar('appointment_data').id : null;

        const query = {
            service_id: service.id,
            provider_id: resolvedProviderId,
            selected_date: date,
            manage_mode: manageMode ? 1 : 0,
            appointment_id: appointmentId,
        };

        const [availableHours, unavailableDates] = await Promise.all([
            postToSite('booking/get_available_hours', {...query, service_duration: service.duration}),
            getFromSite('booking/get_unavailable_dates', query),
        ]);

        await selectServiceProviderDate(String(service.id), resolvedProviderId, date);

        const provider =
            resolvedProviderId === ANY_PROVIDER
                ? {provider_id: ANY_PROVIDER, name: 'Any available provider', timezone: pageVar('default_timezone')}
                : (() => {
                      const found = findProvider(resolvedProviderId);

                      return {
                          provider_id: Number(found.id),
                          name: `${found.first_name} ${found.last_name}`.trim(),
                          timezone: found.timezone,
                      };
                  })();

        const monthFullyBooked = Boolean(unavailableDates?.is_month_unavailable);

        const result = {
            date,
            service: {service_id: Number(service.id), name: service.name, duration_minutes: Number(service.duration)},
            provider,
            available_hours: Array.isArray(availableHours) ? availableHours : [],
            unavailable_dates: Array.isArray(unavailableDates) ? unavailableDates : [],
        };

        if (!result.available_hours.length) {
            result.note = monthFullyBooked
                ? `Nothing is free for ${service.name} anywhere in the month of ${date}. Try a later month.`
                : `Nothing is free for ${service.name} on ${date}. The dates listed in unavailable_dates are also ` +
                  'full, so pick a day outside that list.';
        }

        return result;
    },
});
```
