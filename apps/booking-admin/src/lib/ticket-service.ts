'use server';

import { createClient } from './supabase/server';
import { selectActiveMembership } from './shop-selection';
import {
  canTransition,
  getTransitionError,
  isValidPhone,
  normalizePhone,
  validateDeadline,
  type Attachment,
  type BookingReference,
  type Customer,
  type NewTicketInput,
  type Priority,
  type RetentionCandidate,
  type Status,
  type Ticket,
  type TicketSearchFilters,
  type TimelineEntry,
  type TimelineEventType,
} from './ticket-domain';

interface RawTimelineEntry {
  id: string;
  ticket_id: string;
  shop_id: string;
  event_type: TimelineEventType;
  message: string;
  actor: string;
  created_at: string;
}

interface RawBookingRef {
  id: string;
  booking_code?: string;
  booking_date?: string;
  services?: { name: string } | { name: string }[] | null;
  staff?: { name: string; nickname: string | null } | { name: string; nickname: string | null }[] | null;
  shops?: { name: string } | { name: string }[] | null;
}

interface RawTicket {
  id: string;
  shop_id: string;
  booking_id: string | null;
  service_id: string | null;
  title: string;
  type: Ticket['type'];
  status: Status;
  priority: Priority;
  customer_name: string;
  customer_phone: string;
  normalized_phone: string;
  contact_channel: string | null;
  assigned_to: string | null;
  description: string;
  issue_category: string | null;
  related_product_service: string | null;
  occurred_at: string | null;
  received_at: string;
  due_at: string;
  closed_at: string | null;
  resolution: string | null;
  attachments: Attachment[] | null;
  created_at: string;
  updated_at: string;
  ticket_timeline_entries?: RawTimelineEntry[] | null;
  bookings?: RawBookingRef | RawBookingRef[] | null;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function mapRawTicket(raw: RawTicket): Ticket {
  const timelineEntries: TimelineEntry[] = (raw.ticket_timeline_entries ?? [])
    .map((entry) => ({
      id: entry.id,
      ticketId: entry.ticket_id,
      eventType: entry.event_type,
      message: entry.message,
      actor: entry.actor,
      timestamp: entry.created_at,
    }))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const bookingRaw = firstRelation(raw.bookings);
  let bookingRef: BookingReference | null = null;
  if (bookingRaw) {
    const serviceName = firstRelation(bookingRaw.services)?.name ?? 'บริการทั่วไป';
    const shopBranch = firstRelation(bookingRaw.shops)?.name ?? 'สาขาหลัก';
    const staffObj = firstRelation(bookingRaw.staff);
    const providerTechnician = staffObj?.nickname || staffObj?.name || undefined;

    bookingRef = {
      bookingId: bookingRaw.id,
      serviceDate: bookingRaw.booking_date ?? '',
      serviceName,
      shopBranch,
      providerTechnician,
    };
  }

  const customer: Customer = {
    id: `CUST-${raw.normalized_phone || raw.id.slice(0, 8)}`,
    name: raw.customer_name,
    phone: raw.customer_phone,
    contactChannel: raw.contact_channel ?? '',
  };

  return {
    id: raw.id,
    shopId: raw.shop_id,
    bookingId: raw.booking_id,
    serviceId: raw.service_id,
    title: raw.title,
    type: raw.type,
    status: raw.status,
    priority: raw.priority,
    customerId: customer.id,
    assignedTo: raw.assigned_to,
    description: raw.description,
    issueCategory: raw.issue_category ?? '',
    relatedProductService: raw.related_product_service ?? '',
    occurredAt: raw.occurred_at,
    receivedAt: raw.received_at,
    dueAt: raw.due_at,
    normalizedPhone: raw.normalized_phone,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    closedAt: raw.closed_at,
    resolution: raw.resolution,
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    timeline: timelineEntries,
    customer,
    bookingRef,
  };
}

/**
 * Get current shop membership and authenticated user information
 */
export async function getCurrentShopMembership(): Promise<{ shopId: string; role: 'owner' | 'admin' | 'staff'; userId: string }> {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }

  // Canonical V1 selected shop, shared with the layout Preview and dashboard data (NEW-F12).
  const { data: membership, error: membershipError } = await selectActiveMembership(supabase, authData.user.id);

  if (membershipError || !membership) {
    throw new Error(membershipError?.message || 'ไม่พบสิทธิ์ร้านค้าของบัญชีนี้');
  }

  return {
    shopId: membership.shop_id,
    role: membership.role as 'owner' | 'admin' | 'staff',
    userId: authData.user.id,
  };
}

/**
 * 1. Fetch tickets for a shop with optional search and filters.
 */
export async function fetchTickets(shopId: string, filters?: TicketSearchFilters): Promise<Ticket[]> {
  const supabase = await createClient();

  let query = supabase
    .from('tickets')
    .select(`
      id,
      shop_id,
      booking_id,
      service_id,
      title,
      type,
      status,
      priority,
      customer_name,
      customer_phone,
      normalized_phone,
      contact_channel,
      assigned_to,
      description,
      issue_category,
      related_product_service,
      occurred_at,
      received_at,
      due_at,
      closed_at,
      resolution,
      attachments,
      created_at,
      updated_at,
      ticket_timeline_entries (
        id,
        ticket_id,
        shop_id,
        event_type,
        message,
        actor,
        created_at
      ),
      bookings (
        id,
        booking_code,
        booking_date,
        services ( name ),
        staff ( name, nickname ),
        shops ( name )
      )
    `)
    .eq('shop_id', shopId)
    .order('created_at', { ascending: false });

  if (filters?.statuses && filters.statuses.length > 0) {
    query = query.in('status', filters.statuses);
  }

  if (filters?.types && filters.types.length > 0) {
    query = query.in('type', filters.types);
  }

  if (filters?.receivedFrom) {
    query = query.gte('received_at', filters.receivedFrom);
  }

  if (filters?.receivedTo) {
    query = query.lte('received_at', filters.receivedTo);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`โหลดรายการเคสไม่สำเร็จ: ${error.message}`);
  }

  let tickets = (data as unknown as RawTicket[]).map(mapRawTicket);

  if (filters?.query && filters.query.trim()) {
    const q = filters.query.trim().toLowerCase();
    const qNorm = normalizePhone(q);
    tickets = tickets.filter((t) => {
      const matchId = t.id.toLowerCase().includes(q);
      const matchName = t.customer.name.toLowerCase().includes(q);
      const matchTitle = t.title.toLowerCase().includes(q);
      const matchPhone = qNorm ? t.normalizedPhone.includes(qNorm) : t.customer.phone.includes(q);
      return matchId || matchName || matchTitle || matchPhone;
    });
  }

  if (filters?.overdueOnly) {
    const nowStr = filters.now || new Date().toISOString();
    tickets = tickets.filter((t) => {
      if (t.status === 'Closed') return false;
      const dueTime = Date.parse(t.dueAt);
      const refTime = Date.parse(nowStr);
      return !Number.isNaN(dueTime) && !Number.isNaN(refTime) && dueTime < refTime;
    });
  }

  return tickets;
}

/**
 * 2. Fetch a single ticket by ID.
 */
export async function fetchTicketById(shopId: string, ticketId: string): Promise<Ticket | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('tickets')
    .select(`
      id,
      shop_id,
      booking_id,
      service_id,
      title,
      type,
      status,
      priority,
      customer_name,
      customer_phone,
      normalized_phone,
      contact_channel,
      assigned_to,
      description,
      issue_category,
      related_product_service,
      occurred_at,
      received_at,
      due_at,
      closed_at,
      resolution,
      attachments,
      created_at,
      updated_at,
      ticket_timeline_entries (
        id,
        ticket_id,
        shop_id,
        event_type,
        message,
        actor,
        created_at
      ),
      bookings (
        id,
        booking_code,
        booking_date,
        services ( name ),
        staff ( name, nickname ),
        shops ( name )
      )
    `)
    .eq('shop_id', shopId)
    .eq('id', ticketId)
    .maybeSingle();

  if (error) {
    throw new Error(`โหลดข้อมูลเคสไม่สำเร็จ: ${error.message}`);
  }

  if (!data) return null;

  return mapRawTicket(data as unknown as RawTicket);
}

/**
 * Look up existing tickets by customer's normalized phone number (for duplicate notice).
 */
export async function fetchTicketsByPhone(shopId: string, phone: string): Promise<Ticket[]> {
  if (!isValidPhone(phone)) return [];
  const normalized = normalizePhone(phone);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('tickets')
    .select(`
      id,
      shop_id,
      booking_id,
      service_id,
      title,
      type,
      status,
      priority,
      customer_name,
      customer_phone,
      normalized_phone,
      contact_channel,
      assigned_to,
      description,
      issue_category,
      related_product_service,
      occurred_at,
      received_at,
      due_at,
      closed_at,
      resolution,
      attachments,
      created_at,
      updated_at,
      ticket_timeline_entries (
        id,
        ticket_id,
        shop_id,
        event_type,
        message,
        actor,
        created_at
      )
    `)
    .eq('shop_id', shopId)
    .eq('normalized_phone', normalized)
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  return (data as unknown as RawTicket[]).map(mapRawTicket);
}

/**
 * 3. Create a new ticket with initial timeline entry.
 */
export async function createTicket(
  shopId: string,
  input: NewTicketInput,
  actor = 'staff'
): Promise<{ ok: boolean; ticket?: Ticket; error?: string }> {
  try {
    const requiredText = [input.customerName, input.title, input.description];
    if (
      !input.receivedAt ||
      !input.dueAt ||
      !input.customerPhone ||
      requiredText.some((v) => !v || !v.trim()) ||
      !input.type ||
      !input.priority
    ) {
      return { ok: false, error: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน' };
    }

    if (!isValidPhone(input.customerPhone)) {
      return { ok: false, error: 'รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง (ต้องเป็นตัวเลข 9-15 หลัก)' };
    }

    const deadlineCheck = validateDeadline(input.receivedAt, input.dueAt);
    if (!deadlineCheck.valid) {
      if (deadlineCheck.error === 'DUE_BEFORE_RECEIVED') {
        return { ok: false, error: 'วันครบกำหนดต้องไม่อยู่ก่อนวันที่รับเคส' };
      }
      return { ok: false, error: 'รูปแบบวันที่และเวลาไม่ถูกต้อง' };
    }

    const normalizedPhone = normalizePhone(input.customerPhone);
    const supabase = await createClient();

    const { data: newTicketId, error: rpcError } = await supabase.rpc('create_ticket', {
      p_shop_id: shopId,
      p_booking_id: input.bookingId?.trim() || null,
      p_service_id: input.serviceId?.trim() || null,
      p_title: input.title.trim(),
      p_type: input.type,
      p_priority: input.priority,
      p_customer_name: input.customerName.trim(),
      p_customer_phone: input.customerPhone.trim(),
      p_normalized_phone: normalizedPhone,
      p_contact_channel: input.contactChannel?.trim() || null,
      p_description: input.description.trim(),
      p_issue_category: input.issueCategory?.trim() || '',
      p_related_product_service: input.relatedProductService?.trim() || '',
      p_occurred_at: input.occurredAt?.trim() || null,
      p_received_at: new Date(input.receivedAt).toISOString(),
      p_due_at: new Date(input.dueAt).toISOString(),
      p_idempotency_key: crypto.randomUUID(),
    });

    if (rpcError) {
      return { ok: false, error: rpcError.message };
    }

    if (!newTicketId) {
      return { ok: false, error: 'บันทึกเคสไม่สำเร็จ' };
    }

    if (input.assignedTo?.trim()) {
      await supabase.rpc('update_ticket_assignee', {
        p_ticket_id: newTicketId,
        p_new_assignee: input.assignedTo.trim(),
        p_actor: actor,
      });
    }

    const ticket = await fetchTicketById(shopId, newTicketId);
    return { ok: true, ticket: ticket ?? undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการสร้างเคส' };
  }
}

/**
 * 4. Update ticket status with transition validation and timeline record.
 */
export async function updateTicketStatus(
  shopId: string,
  ticketId: string,
  newStatus: Status,
  actorId = 'staff'
): Promise<{ ok: boolean; ticket?: Ticket; error?: string }> {
  try {
    const ticket = await fetchTicketById(shopId, ticketId);
    if (!ticket) return { ok: false, error: 'ไม่พบเคสที่ระบุ' };

    const transitionError = getTransitionError(ticket.status, newStatus);
    if (transitionError) {
      return { ok: false, error: transitionError };
    }

    const supabase = await createClient();
    const { error: rpcError } = await supabase.rpc('update_ticket_status', {
      p_ticket_id: ticketId,
      p_new_status: newStatus,
      p_actor: actorId,
    });

    if (rpcError) {
      return { ok: false, error: rpcError.message };
    }

    const updated = await fetchTicketById(shopId, ticketId);
    return { ok: true, ticket: updated ?? undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'เปลี่ยนสถานะไม่สำเร็จ' };
  }
}

/**
 * 5. Append timeline entry (e.g. comment, manual note).
 */
export async function appendTimelineEntry(
  shopId: string,
  ticketId: string,
  entry: { eventType: TimelineEventType; message: string; actor: string }
): Promise<{ ok: boolean; timelineEntry?: TimelineEntry; error?: string }> {
  try {
    if (!entry.message.trim()) {
      return { ok: false, error: 'ข้อความความคิดเห็นต้องไม่ว่างเปล่า' };
    }

    const supabase = await createClient();
    const { data: entryId, error: rpcError } = await supabase.rpc('add_ticket_timeline_entry', {
      p_ticket_id: ticketId,
      p_event_type: entry.eventType,
      p_message: entry.message.trim(),
      p_actor: entry.actor,
    });

    if (rpcError) {
      return { ok: false, error: rpcError.message };
    }

    return {
      ok: true,
      timelineEntry: {
        id: entryId ?? crypto.randomUUID(),
        ticketId,
        eventType: entry.eventType,
        message: entry.message.trim(),
        actor: entry.actor,
        timestamp: new Date().toISOString(),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'บันทึกความคิดเห็นไม่สำเร็จ' };
  }
}

/**
 * Update ticket priority
 */
export async function updateTicketPriority(
  shopId: string,
  ticketId: string,
  newPriority: Priority,
  actorId = 'staff'
): Promise<{ ok: boolean; ticket?: Ticket; error?: string }> {
  try {
    const ticket = await fetchTicketById(shopId, ticketId);
    if (!ticket) return { ok: false, error: 'ไม่พบเคสที่ระบุ' };

    const supabase = await createClient();
    const { error: rpcError } = await supabase.rpc('update_ticket_priority', {
      p_ticket_id: ticketId,
      p_new_priority: newPriority,
      p_actor: actorId,
    });

    if (rpcError) {
      return { ok: false, error: rpcError.message };
    }

    const updated = await fetchTicketById(shopId, ticketId);
    return { ok: true, ticket: updated ?? undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'เปลี่ยนระดับความสำคัญไม่สำเร็จ' };
  }
}

/**
 * Update ticket assignee
 */
export async function updateTicketAssignee(
  shopId: string,
  ticketId: string,
  newAssignee: string | null,
  actorId = 'staff'
): Promise<{ ok: boolean; ticket?: Ticket; error?: string }> {
  try {
    const ticket = await fetchTicketById(shopId, ticketId);
    if (!ticket) return { ok: false, error: 'ไม่พบเคสที่ระบุ' };

    const cleanAssignee = newAssignee?.trim() || null;
    const supabase = await createClient();
    const { error: rpcError } = await supabase.rpc('update_ticket_assignee', {
      p_ticket_id: ticketId,
      p_new_assignee: cleanAssignee,
      p_actor: actorId,
    });

    if (rpcError) {
      return { ok: false, error: rpcError.message };
    }

    const updated = await fetchTicketById(shopId, ticketId);
    return { ok: true, ticket: updated ?? undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'เปลี่ยนผู้รับผิดชอบไม่สำเร็จ' };
  }
}

/**
 * Save ticket resolution
 */
export async function saveTicketResolution(
  shopId: string,
  ticketId: string,
  resolution: string,
  actorId = 'staff'
): Promise<{ ok: boolean; ticket?: Ticket; error?: string }> {
  try {
    if (!resolution.trim()) {
      return { ok: false, error: 'รายละเอียดผลการแก้ไขต้องไม่ว่างเปล่า' };
    }

    const ticket = await fetchTicketById(shopId, ticketId);
    if (!ticket) return { ok: false, error: 'ไม่พบเคสที่ระบุ' };

    const supabase = await createClient();
    const { error: rpcError } = await supabase.rpc('save_ticket_resolution', {
      p_ticket_id: ticketId,
      p_resolution: resolution.trim(),
      p_actor: actorId,
    });

    if (rpcError) {
      return { ok: false, error: rpcError.message };
    }

    const updated = await fetchTicketById(shopId, ticketId);
    return { ok: true, ticket: updated ?? undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'บันทึกผลการแก้ไขไม่สำเร็จ' };
  }
}

/**
 * Close ticket (requires resolution to be present)
 */
export async function closeTicket(
  shopId: string,
  ticketId: string,
  actorId = 'staff'
): Promise<{ ok: boolean; ticket?: Ticket; error?: string }> {
  try {
    const ticket = await fetchTicketById(shopId, ticketId);
    if (!ticket) return { ok: false, error: 'ไม่พบเคสที่ระบุ' };

    if (ticket.status === 'Closed') {
      return { ok: false, error: 'เคสนี้ถูกปิดเรียบร้อยแล้ว' };
    }

    if (!ticket.resolution?.trim()) {
      return { ok: false, error: 'ต้องบันทึกผลการแก้ไข (Resolution) ก่อนทำการปิดเคส' };
    }

    const supabase = await createClient();
    const { error: rpcError } = await supabase.rpc('update_ticket_status', {
      p_ticket_id: ticketId,
      p_new_status: 'Closed',
      p_actor: actorId,
    });

    if (rpcError) {
      return { ok: false, error: rpcError.message };
    }

    const updated = await fetchTicketById(shopId, ticketId);
    return { ok: true, ticket: updated ?? undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'ปิดเคสไม่สำเร็จ' };
  }
}

/**
 * Reopen closed ticket
 */
export async function reopenTicket(
  shopId: string,
  ticketId: string,
  actorId = 'staff'
): Promise<{ ok: boolean; ticket?: Ticket; error?: string }> {
  try {
    const ticket = await fetchTicketById(shopId, ticketId);
    if (!ticket) return { ok: false, error: 'ไม่พบเคสที่ระบุ' };

    if (ticket.status !== 'Closed') {
      return { ok: false, error: 'เปิดเคสใหม่ได้เฉพาะเคสที่มีสถานะ Closed เท่านั้น' };
    }

    const supabase = await createClient();
    const { error: rpcError } = await supabase.rpc('update_ticket_status', {
      p_ticket_id: ticketId,
      p_new_status: 'Reopened',
      p_actor: actorId,
    });

    if (rpcError) {
      return { ok: false, error: rpcError.message };
    }

    const updated = await fetchTicketById(shopId, ticketId);
    return { ok: true, ticket: updated ?? undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'เปิดเคสใหม่ไม่สำเร็จ' };
  }
}

/**
 * 6. Preview candidates eligible for retention cleanup.
 * Strictly checks status = 'Closed' and closed_at <= cutoff date (end of day).
 */
export async function previewRetentionCleanup(shopId: string, cutoff: string): Promise<RetentionCandidate[]> {
  const supabase = await createClient();
  const cutoffTimestamp = `${cutoff}T23:59:59.999Z`;

  const { data, error } = await supabase
    .from('tickets')
    .select('id, closed_at, customer_name, title, attachments')
    .eq('shop_id', shopId)
    .eq('status', 'Closed')
    .lte('closed_at', cutoffTimestamp)
    .order('closed_at', { ascending: true });

  if (error || !data) {
    throw new Error(`ตรวจสอบรายการหมดอายุไม่สำเร็จ: ${error?.message}`);
  }

  return data.map((row) => ({
    id: row.id,
    closedAt: row.closed_at ?? '',
    customerName: row.customer_name,
    title: row.title,
    attachmentCount: Array.isArray(row.attachments) ? row.attachments.length : 0,
  }));
}

/**
 * 7. Explicit two-step manual retention deletion.
 * Deletes Closed tickets before the cutoff date only after user confirmation. Never automatic.
 */
export async function deleteClosedTicketsBefore(
  shopId: string,
  cutoff: string
): Promise<{ ok: boolean; deletedCount: number; error?: string }> {
  try {
    const candidates = await previewRetentionCleanup(shopId, cutoff);
    if (candidates.length === 0) {
      return { ok: true, deletedCount: 0 };
    }

    const candidateIds = candidates.map((c) => c.id);
    const supabase = await createClient();

    const { error } = await supabase
      .from('tickets')
      .delete()
      .eq('shop_id', shopId)
      .eq('status', 'Closed')
      .in('id', candidateIds);

    if (error) {
      return { ok: false, deletedCount: 0, error: error.message };
    }

    return { ok: true, deletedCount: candidateIds.length };
  } catch (err) {
    return { ok: false, deletedCount: 0, error: err instanceof Error ? err.message : 'ลบข้อมูลไม่สำเร็จ' };
  }
}
