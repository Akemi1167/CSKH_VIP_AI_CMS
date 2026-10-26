import { Alert, Button, DatePicker, Form, Modal, Segmented, Select, Switch, TimePicker, Typography } from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api, fieldErrorsFrom } from "../api.ts";
import { TIMEZONES } from "../copy.ts";
import { clockLabel, clockState, shiftFieldErrors } from "../schedule.ts";
import type { FieldErrors, Shift } from "../types.ts";
import { ErrorAlert } from "../ui.tsx";
import { RosterGrid } from "./RosterGrid.tsx";

type When = "now" | "later";

type FormState = {
  timezone: string;
  start: Dayjs | null;
  end: Dayjs | null;
  breakOn: boolean;
  breakStart: Dayjs | null;
  breakEnd: Dayjs | null;
  when: When;
  effective: Dayjs | null;
};

const KNOWN = ["timezone", "start_local", "end_local", "break_start_local", "break_end_local", "effective_from"];

export function ScheduleBoard(props: {
  canAdmin: boolean;
  canWrite: boolean;
  canListStaff: boolean;
  onUnauthorized: () => void;
  onMfaSetup: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [current, setCurrent] = useState<Shift | null>(null);
  const [upcoming, setUpcoming] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(null));
  const [baseline, setBaseline] = useState<string | null>(() => signature(emptyForm(null)));
  const [fields, setFields] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const failAuth = useCallback(
    (error: ApiError) => {
      if (error.status === 401) {
        props.onUnauthorized();
        return true;
      }
      if (error.code === "mfa_setup_required") {
        props.onMfaSetup();
        return true;
      }
      return false;
    },
    [props],
  );

  const refresh = useCallback(async () => {
    try {
      if (props.canAdmin) {
        const result = await api<{ shift: Shift | null; next_shift: Shift | null }>("/api/v1/admin/schedule");
        setCurrent(result.shift);
        setUpcoming(result.next_shift);
        const next = emptyForm(result.next_shift ?? result.shift);
        setForm(next);
        setBaseline(result.shift || result.next_shift ? signature(next) : null);
      } else {
        const result = await api<{ shift: Shift | null }>("/api/v1/schedule");
        setCurrent(result.shift);
        setUpcoming(null);
      }
      setLoadError(null);
    } catch (caught) {
      const error = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được ca làm", "");
      if (!failAuth(error)) {
        setLoadError(error);
      }
    }
  }, [failAuth, props.canAdmin]);

  useEffect(() => {
    let ignore = false;
    refresh().finally(() => {
      if (!ignore) {
        setLoading(false);
      }
    });
    return () => {
      ignore = true;
    };
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const dirty = props.canWrite && (baseline === null || signature(form) !== baseline);

  useEffect(() => {
    props.onDirtyChange(dirty);
  }, [dirty, props.onDirtyChange]);

  useEffect(() => {
    if (!dirty) {
      return;
    }
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const zones = useMemo(() => {
    if (TIMEZONES.some((zone) => zone.value === form.timezone)) {
      return TIMEZONES;
    }
    return [{ value: form.timezone, label: form.timezone }, ...TIMEZONES];
  }, [form.timezone]);

  async function submit() {
    const errors = shiftFieldErrors({
      timezone: form.timezone,
      start: timeText(form.start),
      end: timeText(form.end),
      breakOn: form.breakOn,
      breakStart: timeText(form.breakStart),
      breakEnd: timeText(form.breakEnd),
      when: form.when,
      effective: form.effective?.toDate() ?? null,
    });
    setFields(errors);
    setFormError(null);
    setSaved(null);
    if (Object.keys(errors).length > 0) {
      return;
    }
    setSaving(true);
    try {
      const savedShift = await api<{ shift: Shift }>("/api/v1/admin/schedule", {
        method: "PUT",
        body: {
          timezone: form.timezone,
          start_local: timeText(form.start),
          end_local: timeText(form.end),
          break_start_local: form.breakOn ? timeText(form.breakStart) : null,
          break_end_local: form.breakOn ? timeText(form.breakEnd) : null,
          ...(form.when === "later" && form.effective ? { effective_from: form.effective.toDate().toISOString() } : {}),
        },
      });
      await refresh();
      setSaved(savedShift.shift.effective_from > new Date().toISOString() ? "Đã hẹn ca mới." : "Ca mới đã có hiệu lực.");
      setFields({});
    } catch (caught) {
      const error = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không lưu được ca làm", "");
      if (failAuth(error)) {
        return;
      }
      const parsed = fieldErrorsFrom(error, KNOWN);
      setFields(parsed.fields);
      setFormError(parsed.extra ? new ApiError(error.status, error.code, `${error.message}. ${parsed.extra}`, error.requestId) : error);
    } finally {
      setSaving(false);
    }
  }

  const state = current ? clockState(now, current) : null;

  return (
    <section>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-header__title">
            Ca làm
          </Typography.Title>
          <Typography.Text type="secondary">
            {hoursLine(current, state ? clockLabel(state) : null)}
            {upcoming ? ` Ca sắp tới ${upcoming.start_local}–${upcoming.end_local}.` : ""}
          </Typography.Text>
        </div>
        {props.canWrite ? <Button onClick={() => setHoursOpen(true)}>Sửa giờ ca</Button> : null}
      </div>

      {loadError ? (
        <ErrorAlert
          error={loadError}
          action={
            <button
              type="button"
              className="notice__retry"
              onClick={() => {
                setLoading(true);
                refresh().finally(() => setLoading(false));
              }}
            >
              Thử lại
            </button>
          }
        />
      ) : null}

      <RosterGrid
        shift={current ?? upcoming}
        canList={props.canListStaff}
        canWrite={props.canWrite && Boolean(current ?? upcoming)}
        onUnauthorized={props.onUnauthorized}
        onMfaSetup={props.onMfaSetup}
      />

      {props.canWrite ? (
        <Modal
          title="Giờ ca của team"
          open={hoursOpen}
          centered
          width={640}
          footer={null}
          onCancel={() => setHoursOpen(false)}
          styles={{ body: { maxHeight: "calc(100vh - 220px)", overflow: "auto" } }}
        >
          <div className="shift-grid">
            <ShiftCard title="Đang dùng" shift={current} loading={loading} extra={state ? clockLabel(state) : null} />
            {props.canAdmin ? <ShiftCard title="Sắp tới" shift={upcoming} loading={loading} empty="Chưa hẹn ca mới" /> : null}
          </div>
          <div className="shift-form">
          {saved ? <Alert type="success" showIcon style={{ marginBottom: 12 }} message={saved} /> : null}
          <ErrorAlert error={formError} />
          <Form className="staff-form" layout="vertical" requiredMark={false} onFinish={() => void submit()}>
            <div className="staff-split">
              <Form.Item label="Giờ bắt đầu" validateStatus={fields.start_local ? "error" : ""} help={fields.start_local}>
                <TimePicker
                  format="HH:mm"
                  needConfirm={false}
                  style={{ width: "100%" }}
                  value={form.start}
                  onChange={(value) => setForm((currentForm) => ({ ...currentForm, start: value }))}
                />
              </Form.Item>
              <Form.Item label="Giờ kết thúc" validateStatus={fields.end_local ? "error" : ""} help={fields.end_local}>
                <TimePicker
                  format="HH:mm"
                  needConfirm={false}
                  style={{ width: "100%" }}
                  value={form.end}
                  onChange={(value) => setForm((currentForm) => ({ ...currentForm, end: value }))}
                />
              </Form.Item>
            </div>
            <Form.Item label="Nghỉ giữa ca">
              <Switch checked={form.breakOn} onChange={(breakOn) => setForm((currentForm) => ({ ...currentForm, breakOn }))} />
            </Form.Item>
            {form.breakOn ? (
              <div className="staff-split">
                <Form.Item label="Bắt đầu nghỉ" validateStatus={fields.break_start_local ? "error" : ""} help={fields.break_start_local}>
                  <TimePicker
                    format="HH:mm"
                    needConfirm={false}
                    style={{ width: "100%" }}
                    value={form.breakStart}
                    onChange={(value) => setForm((currentForm) => ({ ...currentForm, breakStart: value }))}
                  />
                </Form.Item>
                <Form.Item label="Kết thúc nghỉ" validateStatus={fields.break_end_local ? "error" : ""} help={fields.break_end_local}>
                  <TimePicker
                    format="HH:mm"
                    needConfirm={false}
                    style={{ width: "100%" }}
                    value={form.breakEnd}
                    onChange={(value) => setForm((currentForm) => ({ ...currentForm, breakEnd: value }))}
                  />
                </Form.Item>
              </div>
            ) : null}
            <Form.Item label="Múi giờ" validateStatus={fields.timezone ? "error" : ""} help={fields.timezone}>
              <Select
                value={form.timezone}
                options={zones.map((zone) => ({ value: zone.value, label: zone.label }))}
                onChange={(timezone) => setForm((currentForm) => ({ ...currentForm, timezone }))}
              />
            </Form.Item>
            <Form.Item label="Hiệu lực" validateStatus={fields.effective_from ? "error" : ""} help={fields.effective_from || "Hẹn giờ theo đồng hồ trên máy bạn."}>
              <Segmented
                value={form.when}
                options={[
                  { label: "Ngay bây giờ", value: "now" },
                  { label: "Hẹn giờ", value: "later" },
                ]}
                onChange={(when) => setForm((currentForm) => ({ ...currentForm, when: when as When }))}
              />
              {form.when === "later" ? (
                <DatePicker
                  showTime={{ format: "HH:mm" }}
                  format="DD/MM/YYYY HH:mm"
                  style={{ width: "100%", marginTop: 8 }}
                  value={form.effective}
                  onChange={(effective) => setForm((currentForm) => ({ ...currentForm, effective }))}
                />
              ) : null}
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={saving} disabled={!dirty}>
              Lưu ca
            </Button>
          </Form>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function ShiftCard(props: { title: string; shift: Shift | null; loading: boolean; empty?: string; extra?: string | null }) {
  return (
    <article className="shift-card">
      <p className="shift-card__label">
        {props.title}
        {props.extra ? ` · ${props.extra}` : ""}
      </p>
      {props.loading && !props.shift ? <p className="shift-card__hours">…</p> : null}
      {!props.loading && !props.shift ? <p className="shift-card__hours">{props.empty ?? "Chưa có ca"}</p> : null}
      {props.shift ? (
        <>
          <p className="shift-card__hours">
            {props.shift.start_local}–{props.shift.end_local}
          </p>
          <p className="page-note" style={{ marginTop: 0 }}>
            {props.shift.break_start_local && props.shift.break_end_local
              ? `Nghỉ ${props.shift.break_start_local}–${props.shift.break_end_local}`
              : "Không nghỉ giữa ca"}
          </p>
          <p className="page-note">
            {zoneLabel(props.shift.timezone)} · từ {formatWhen(props.shift.effective_from, props.shift.timezone)}
          </p>
        </>
      ) : null}
    </article>
  );
}

function hoursLine(shift: Shift | null, state: string | null): string {
  if (!shift) {
    return "Chưa có giờ ca. Đặt giờ ca trước khi ghi nghỉ từng ngày.";
  }
  const pause = shift.break_start_local && shift.break_end_local ? `, nghỉ ${shift.break_start_local}–${shift.break_end_local}` : "";
  return `Ca team ${shift.start_local}–${shift.end_local}${pause}${state ? ` · ${state}` : ""}.`;
}

function emptyForm(shift: Shift | null): FormState {
  return {
    timezone: shift?.timezone ?? "Asia/Ho_Chi_Minh",
    start: parseTime(shift?.start_local ?? "08:00"),
    end: parseTime(shift?.end_local ?? "17:00"),
    breakOn: Boolean(shift?.break_start_local && shift.break_end_local),
    breakStart: parseTime(shift?.break_start_local ?? "12:00"),
    breakEnd: parseTime(shift?.break_end_local ?? "13:00"),
    when: "now",
    effective: null,
  };
}

function parseTime(value: string): Dayjs {
  const [hour, minute] = value.slice(0, 5).split(":");
  return dayjs().hour(Number(hour)).minute(Number(minute)).second(0).millisecond(0);
}

function timeText(value: Dayjs | null): string {
  return value ? value.format("HH:mm") : "";
}

function signature(form: FormState): string {
  return [
    form.timezone,
    timeText(form.start),
    timeText(form.end),
    form.breakOn ? "1" : "0",
    form.breakOn ? timeText(form.breakStart) : "",
    form.breakOn ? timeText(form.breakEnd) : "",
    form.when,
    form.when === "later" ? (form.effective?.toISOString() ?? "") : "",
  ].join("|");
}

function zoneLabel(timezone: string): string {
  return TIMEZONES.find((zone) => zone.value === timezone)?.label ?? timezone;
}

function formatWhen(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
