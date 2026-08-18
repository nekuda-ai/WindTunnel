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
 * WebMCP tool: reschedule_appointment.
 *
 * Registered only on an appointment's own reschedule page, where the site has already resolved the
 * appointment from its hash. The tool moves that appointment through the same wizard the visitor
 * would use, and never takes an appointment id of its own.
 */

import {defineTool} from '@nekuda/webmcp';
import {ANY_PROVIDER, findService, isManageMode, pageVar, requireBookingWizard, resolveProviderId} from './support.js';
import {
    advanceToConfirmation,
    confirmationUrl,
    fillCustomerForm,
    readPostData,
    requireConsentGiven,
    selectHour,
    selectServiceProviderDate,
    selectedTimezone,
    submitRegistration,
} from './wizard.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

export const rescheduleAppointment = defineTool({
    stableKey: 'booking.appointment.reschedule',
    name: 'reschedule_appointment',
    title: 'Move this appointment',
    description:
        'Move the appointment shown on this page to a different date and time, and optionally to a different ' +
        "service or provider. This tool is only available on an appointment's own reschedule page, where the " +
        'appointment is already fixed — you never pass its id. Confirm the new slot with check_availability first. ' +
        "This updates the appointment in the business's schedule and emails the customer. Returns the " +
        "appointment's confirmation hash and its new start time.",
    inputSchema: {
        type: 'object',
        properties: {
            date: {
                type: 'string',
                description: 'The new appointment day, as YYYY-MM-DD.',
                pattern: '^\\d{4}-\\d{2}-\\d{2}$',
            },
            time: {
                type: 'string',
                description: 'The new start time as HH:mm, exactly as check_availability returned it.',
                pattern: '^\\d{2}:\\d{2}$',
            },
            service_id: {
                type: 'integer',
                description: 'Optional. Switch the appointment to a different service.',
            },
            provider_id: {
                description: 'Optional. Switch the appointment to a different provider, or "any-provider".',
                anyOf: [{type: 'integer'}, {type: 'string', enum: [ANY_PROVIDER]}],
            },
            notes: {type: 'string', description: 'Optional. Replace the note the provider sees.'},
        },
        required: ['date', 'time'],
        additionalProperties: false,
    },
    annotations: {readOnlyHint: false, untrustedContentHint: false},
    async execute(input) {
        requireBookingWizard();

        if (!isManageMode()) {
            throw new Error(
                'There is no appointment on this page to move. Open the reschedule link from the booking ' +
                    'confirmation email first.',
            );
        }

        if (!DATE_PATTERN.test(input.date)) {
            throw new Error(`"${input.date}" is not a date. Pass the day as YYYY-MM-DD.`);
        }

        if (!TIME_PATTERN.test(input.time)) {
            throw new Error(`"${input.time}" is not a time. Pass the start time as HH:mm.`);
        }

        const appointment = pageVar('appointment_data');
        const previousStart = appointment.start_datetime;

        const service = findService(input.service_id ?? appointment.id_services);
        const providerId = resolveProviderId(service.id, input.provider_id ?? appointment.id_users_provider);

        await selectServiceProviderDate(String(service.id), providerId, input.date);

        selectHour(input.time, input.date);

        if (input.notes !== undefined) {
            fillCustomerForm({notes: input.notes});
        }

        await advanceToConfirmation();

        requireConsentGiven();

        const postData = readPostData();
        const response = await submitRegistration(postData, appointment.id);
        const url = confirmationUrl(response.appointment_hash);

        window.location.assign(url);

        return {
            appointment_hash: response.appointment_hash,
            previous_start_datetime: previousStart,
            start_datetime: postData.appointment.start_datetime,
            end_datetime: postData.appointment.end_datetime,
            service: {service_id: Number(service.id), name: service.name},
            provider_id: providerId,
            displayed_timezone: selectedTimezone(),
            confirmation_url: url,
        };
    },
});
```
