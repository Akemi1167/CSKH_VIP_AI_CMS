import { Alert, Button, DatePicker, Form, Modal, Segmented, Select, Switch, TimePicker, Typography } from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDeskLang, useTr } from "./language.tsx";
import { ApiError, api, fieldErrorsFrom } from "../api.ts";
import { timezoneChoices, timezoneName } from "../copy.ts";
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
  canWriteHours: boolean;
  canWriteRoster: boolean;
  rosterScope: "all" | "team";
  onUnauthorized: () => void;
  onMfaSetup: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const tr = useTr();
  const trRef = useRef(tr);
  trRef.current = tr;
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
    [props.onUnauthorized, props.onMfaSetup],
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
      const error = caught instanceof ApiError ? caught : new ApiError(0, "network", trRef.current("Không tải được ca làm", "无法加载班次"), "");
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

  const dirty = props.canWriteHours && (baseline === null || signature(form) !== baseline);

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

  const lang = useDeskLang();
  const zones = useMemo(() => {
    const choices = timezoneChoices();
    if (choices.some((zone) => zone.value === form.timezone)) {
      return choices;
    }
    return [{ value: form.timezone, label: form.timezone }, ...choices];
  }, [form.timezone, lang]);

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
      setSaved(savedShift.shift.effective_from > new Date().toISOString() ? tr("Đã hẹn ca mới.", "已预约新班次。") : tr("Ca mới đã có hiệu lực.", "新班次已生效。"));
      setFields({});
    } catch (caught) {
      const error = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không lưu được ca làm", "无法保存班次"), "");
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
            {tr("Ca làm", "班次")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {hoursLine(current, state ? clockLabel(state) : null, tr)}
            {upcoming ? tr(` Ca sắp tới ${upcoming.start_local}–${upcoming.end_local}.`, ` 即将开始的班次 ${upcoming.start_local}–${upcoming.end_local}。`) : ""}
            {props.rosterScope === "team" ? tr(" Bạn ghi nghỉ cho nhân viên các đài mình phụ trách.", " 你可以为自己负责站点的员工登记休息。") : ""}
          </Typography.Text>
        </div>
        {props.canWriteHours ? <Button onClick={() => setHoursOpen(true)}>{tr("Sửa giờ ca", "编辑班次时间")}</Button> : null}
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
              {tr("Thử lại", "重试")}
            </button>
          }
        />
      ) : null}

      <RosterGrid
        shift={current ?? upcoming}
        canList
        canWrite={props.canWriteRoster && Boolean(current ?? upcoming)}
        scope={props.rosterScope}
        onUnauthorized={props.onUnauthorized}
        onMfaSetup={props.onMfaSetup}
      />

      {props.canWriteHours ? (
        <Modal
          title={tr("Giờ ca của team", "团队班次时间")}
          open={hoursOpen}
          centered
          width={640}
          footer={null}
          onCancel={() => setHoursOpen(false)}
          styles={{ body: { maxHeight: "calc(100vh - 220px)", overflow: "auto" } }}
        >
          <div className="shift-grid">
            <ShiftCard title={tr("Đang dùng", "使用中")} shift={current} loading={loading} extra={state ? clockLabel(state) : null} />
            {props.canAdmin ? <ShiftCard title={tr("Sắp tới", "即将开始")} shift={upcoming} loading={loading} empty={tr("Chưa hẹn ca mới", "尚未预约新班次")} /> : null}
          </div>
          <div className="shift-form">
          {saved ? <Alert type="success" showIcon style={{ marginBottom: 12 }} message={saved} /> : null}
          <ErrorAlert error={formError} />
          <Form className="staff-form" layout="vertical" requiredMark={false} onFinish={() => void submit()}>
            <div className="staff-split">
              <Form.Item label={tr("Giờ bắt đầu", "开始时间")} validateStatus={fields.start_local ? "error" : ""} help={fields.start_local}>
                <TimePicker
                  format="HH:mm"
                  needConfirm={false}
                  style={{ width: "100%" }}
                  value={form.start}
                  onChange={(value) => setForm((currentForm) => ({ ...currentForm, start: value }))}
                />
              </Form.Item>
              <Form.Item label={tr("Giờ kết thúc", "结束时间")} validateStatus={fields.end_local ? "error" : ""} help={fields.end_local}>
                <TimePicker
                  format="HH:mm"
                  needConfirm={false}
                  style={{ width: "100%" }}
                  value={form.end}
                  onChange={(value) => setForm((currentForm) => ({ ...currentForm, end: value }))}
                />
              </Form.Item>
            </div>
            <Form.Item label={tr("Nghỉ giữa ca", "班中休息")}>
              <Switch checked={form.breakOn} onChange={(breakOn) => setForm((currentForm) => ({ ...currentForm, breakOn }))} />
            </Form.Item>
            {form.breakOn ? (
              <div className="staff-split">
                <Form.Item label={tr("Bắt đầu nghỉ", "休息开始")} validateStatus={fields.break_start_local ? "error" : ""} help={fields.break_start_local}>
                  <TimePicker
                    format="HH:mm"
                    needConfirm={false}
                    style={{ width: "100%" }}
                    value={form.breakStart}
                    onChange={(value) => setForm((currentForm) => ({ ...currentForm, breakStart: value }))}
                  />
                </Form.Item>
                <Form.Item label={tr("Kết thúc nghỉ", "休息结束")} validateStatus={fields.break_end_local ? "error" : ""} help={fields.break_end_local}>
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
            <Form.Item label={tr("Múi giờ", "时区")} validateStatus={fields.timezone ? "error" : ""} help={fields.timezone}>
              <Select
                value={form.timezone}
                options={zones.map((zone) => ({ value: zone.value, label: zone.label }))}
                onChange={(timezone) => setForm((currentForm) => ({ ...currentForm, timezone }))}
              />
            </Form.Item>
            <Form.Item label={tr("Hiệu lực", "生效时间")} validateStatus={fields.effective_from ? "error" : ""} help={fields.effective_from || tr("Hẹn giờ theo đồng hồ trên máy bạn.", "按你电脑上的时钟预约。")}>
              <Segmented
                value={form.when}
                options={[
                  { label: tr("Ngay bây giờ", "立即生效"), value: "now" },
                  { label: tr("Hẹn giờ", "预约时间"), value: "later" },
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
              {tr("Lưu ca", "保存班次")}
            </Button>
          </Form>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function ShiftCard(props: { title: string; shift: Shift | null; loading: boolean; empty?: string; extra?: string | null }) {
  const tr = useTr();
  const zone = props.shift ? zoneLabel(props.shift.timezone) : "";
  const when = props.shift ? formatWhen(props.shift.effective_from, props.shift.timezone) : "";
  return (
    <article className="shift-card">
      <p className="shift-card__label">
        {props.title}
        {props.extra ? ` · ${props.extra}` : ""}
      </p>
      {props.loading && !props.shift ? <p className="shift-card__hours">…</p> : null}
      {!props.loading && !props.shift ? <p className="shift-card__hours">{props.empty ?? tr("Chưa có ca", "暂无班次")}</p> : null}
      {props.shift ? (
        <>
          <p className="shift-card__hours">
            {props.shift.start_local}–{props.shift.end_local}
          </p>
          <p className="page-note" style={{ marginTop: 0 }}>
            {props.shift.break_start_local && props.shift.break_end_local
              ? tr(`Nghỉ ${props.shift.break_start_local}–${props.shift.break_end_local}`, `休息 ${props.shift.break_start_local}–${props.shift.break_end_local}`)
              : tr("Không nghỉ giữa ca", "无班中休息")}
          </p>
          <p className="page-note">
            {tr(`${zone} · từ ${when}`, `${zone} · 从 ${when}`)}
          </p>
        </>
      ) : null}
    </article>
  );
}

function hoursLine(shift: Shift | null, state: string | null, tr: (vi: string, zh: string) => string): string {
  if (!shift) {
    return tr("Chưa có giờ ca. Đặt giờ ca trước khi ghi nghỉ từng ngày.", "尚未设置班次时间。请先设置班次时间，再按天登记休息。");
  }
  const pauseVi = shift.break_start_local && shift.break_end_local ? `, nghỉ ${shift.break_start_local}–${shift.break_end_local}` : "";
  const pauseZh = shift.break_start_local && shift.break_end_local ? `，休息 ${shift.break_start_local}–${shift.break_end_local}` : "";
  const tail = state ? ` · ${state}` : "";
  return tr(
    `Ca team ${shift.start_local}–${shift.end_local}${pauseVi}${tail}.`,
    `团队班次 ${shift.start_local}–${shift.end_local}${pauseZh}${tail}。`,
  );
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
  return timezoneName(timezone);
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
