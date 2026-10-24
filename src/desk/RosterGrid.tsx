import { LeftOutlined, ReloadOutlined, RightOutlined } from "@ant-design/icons";
import { Alert, Button, Input, Space, Spin, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "../api.ts";
import { classifyDay, dayWindows, markBody, nextMark, type Mark } from "../roster.ts";
import type { Leave, Shift, Staff } from "../types.ts";

const WEEKDAY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

const LEGEND: { mark: Mark | "O"; label: string; title: string }[] = [
  { mark: "N", label: "N", title: "Cả ngày" },
  { mark: "S", label: "S", title: "Nghỉ sáng" },
  { mark: "C", label: "C", title: "Nghỉ chiều" },
  { mark: "K", label: "K", title: "Không lương" },
  { mark: "O", label: "O", title: "Ngày ngoài giờ làm" },
];

const TITLES: Record<Mark, string> = {
  none: "Đi làm — bấm để ghi nghỉ",
  N: "Cả ngày",
  S: "Nghỉ sáng",
  C: "Nghỉ chiều",
  K: "Không lương",
};

export function RosterGrid(props: {
  shift: Shift | null;
  canList: boolean;
  canWrite: boolean;
  onUnauthorized: () => void;
  onMfaSetup: () => void;
}) {
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m0: today.getMonth() });
  const [query, setQuery] = useState("");
  const [staff, setStaff] = useState<Staff[]>([]);
  const [leaves, setLeaves] = useState<Map<string, Leave[]>>(new Map());
  const [loading, setLoading] = useState(props.canList);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const lock = useRef(false);
  const epoch = useRef(0);
  const canList = props.canList;
  const unauthorized = props.onUnauthorized;
  const mfaSetup = props.onMfaSetup;

  const failAuth = useCallback(
    (caught: ApiError) => {
      if (caught.status === 401) {
        unauthorized();
        return true;
      }
      if (caught.code === "mfa_setup_required") {
        mfaSetup();
        return true;
      }
      return false;
    },
    [mfaSetup, unauthorized],
  );

  const load = useCallback(async () => {
    if (!canList) {
      setLoading(false);
      return;
    }
    const ticket = epoch.current;
    try {
      const listed = await api<{ items: Staff[] }>("/api/v1/admin/staff");
      const active = listed.items.filter((person) => person.status === "active");
      const nextLeaves = new Map<string, Leave[]>();
      const failed: string[] = [];
      await mapPool(active, 6, async (person) => {
        try {
          const schedule = await api<{ leave: Leave[] }>(`/api/v1/admin/staff/${person.id}/schedule`);
          nextLeaves.set(person.id, schedule.leave);
        } catch (caught) {
          const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được lịch nghỉ", "");
          if (failAuth(problem)) {
            throw problem;
          }
          failed.push(person.display_name);
          nextLeaves.set(person.id, []);
        }
      });
      if (ticket !== epoch.current) {
        return;
      }
      setStaff(active);
      setLeaves(nextLeaves);
      setError(failed.length ? new ApiError(0, "partial", `Không tải được lịch của ${failed.join(", ")}`, "") : null);
    } catch (caught) {
      if (ticket !== epoch.current) {
        return;
      }
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không tải được lịch làm", "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      if (ticket === epoch.current) {
        setLoading(false);
      }
    }
  }, [canList, failAuth]);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(() => monthDays(cursor.y, cursor.m0), [cursor]);
  const visible = useMemo(() => {
    const text = query.trim().toLocaleLowerCase("vi");
    if (!text) {
      return staff;
    }
    return staff.filter((person) => `${person.display_name} ${person.username}`.toLocaleLowerCase("vi").includes(text));
  }, [query, staff]);

  async function cycle(person: Staff, day: number) {
    if (!props.shift || !props.canWrite || lock.current) {
      return;
    }
    const key = `${person.id}|${day}`;
    const windows = dayWindows(props.shift, cursor.y, cursor.m0 + 1, day);
    const current = classifyDay(leaves.get(person.id) ?? [], windows);
    if (current.locked) {
      return;
    }
    const next = nextMark(current.mark);
    const body = next === "none" ? null : markBody(next, windows);
    if (next !== "none" && !body) {
      setError(new ApiError(0, "shift", "Ca này không tách được sáng và chiều", ""));
      return;
    }
    lock.current = true;
    epoch.current += 1;
    setPending(key);
    setNotice(null);
    setLeaves((currentLeaves) => {
      const drop = new Set(current.owned.map((item) => item.id));
      const kept = (currentLeaves.get(person.id) ?? []).filter((item) => !drop.has(item.id));
      if (body) {
        kept.push({ id: `pending-${key}`, user_id: person.id, kind: body.kind, starts_at: body.starts_at, ends_at: body.ends_at });
      }
      return new Map(currentLeaves).set(person.id, kept);
    });
    try {
      for (const leave of current.owned) {
        await api<null>(`/api/v1/admin/staff/${person.id}/leave/${leave.id}`, { method: "DELETE" });
      }
      if (body) {
        const created = await api<{ leave: Leave; released_task_count: number }>(`/api/v1/admin/staff/${person.id}/leave`, {
          method: "POST",
          body,
        });
        if (created.released_task_count > 0) {
          setNotice(`Đã trả ${created.released_task_count} hội thoại đang mở về hàng chờ.`);
        }
      }
      const fresh = await api<{ leave: Leave[] }>(`/api/v1/admin/staff/${person.id}/schedule`);
      setLeaves((currentLeaves) => new Map(currentLeaves).set(person.id, fresh.leave));
      setError(null);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", "Không lưu được ngày nghỉ", "");
      if (!failAuth(problem)) {
        setError(problem);
        try {
          const fresh = await api<{ leave: Leave[] }>(`/api/v1/admin/staff/${person.id}/schedule`);
          setLeaves((currentLeaves) => new Map(currentLeaves).set(person.id, fresh.leave));
        } catch {
          // The error above is the one to show.
        }
      }
    } finally {
      lock.current = false;
      setPending(null);
    }
  }

  return (
    <section className="roster">
      <div className="roster__bar">
        <Space wrap size={8}>
          {LEGEND.map((item) => (
            <span key={item.mark} className={`roster-chip roster-chip--${item.mark.toLowerCase()}`}>
              {item.mark === "O" ? "○" : item.label} — {item.title}
            </span>
          ))}
        </Space>
        <Space wrap>
          <Input allowClear placeholder="Tìm thành viên" value={query} onChange={(event) => setQuery(event.target.value)} style={{ width: 180 }} />
          <Button icon={<LeftOutlined />} aria-label="Tháng trước" onClick={() => setCursor((currentCursor) => shiftMonth(currentCursor, -1))} />
          <Typography.Text strong>
            Tháng {cursor.m0 + 1}/{cursor.y}
          </Typography.Text>
          <Button icon={<RightOutlined />} aria-label="Tháng sau" onClick={() => setCursor((currentCursor) => shiftMonth(currentCursor, 1))} />
          <Button type="link" onClick={() => setCursor({ y: today.getFullYear(), m0: today.getMonth() })}>
            Tháng này
          </Button>
          <Button icon={<ReloadOutlined />} aria-label="Tải lại" onClick={() => void load()} />
        </Space>
      </div>
      <p className="page-note" style={{ marginTop: 0 }}>
        Ô trống là đang đi làm. Bấm lần lượt: cả ngày, nghỉ sáng, nghỉ chiều, không lương, rồi về đi làm. Sáng là trước giờ nghỉ giữa ca, chiều là sau giờ nghỉ. Không có giờ nghỉ thì chia đôi ca. Mục O là ngày ngoài giờ làm; lịch này chưa có ngày nghỉ cố định nên chưa tô ô đó.
      </p>
      {notice ? <Alert type="info" showIcon style={{ marginBottom: 12 }} message={notice} /> : null}
      {error ? <Alert type="error" showIcon style={{ marginBottom: 12 }} message={error.message} /> : null}
      {!props.canList ? <Alert type="warning" showIcon message="Bạn không có quyền xem danh sách nhân viên." /> : null}
      {!props.shift ? <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Chưa có giờ ca. Đặt giờ ca trước khi ghi nghỉ." /> : null}
      {loading ? (
        <div className="roster__loading">
          <Spin />
        </div>
      ) : null}
      {props.canList && !loading && visible.length === 0 ? <Alert type="info" showIcon message={staff.length ? "Không có thành viên khớp." : "Chưa có nhân viên đang làm."} /> : null}
      {props.canList && !loading && visible.length > 0 ? (
        <div className="roster-scroll">
          <table className="roster-table">
            <thead>
              <tr>
                <th className="roster-name">
                  <span className="roster-name__label">Thành viên</span>
                </th>
                {days.map((day) => (
                  <th key={day.day}>
                    <div>{day.day}</div>
                    <div className="roster-weekday">{WEEKDAY[day.weekday]}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((person) => (
                <tr key={person.id}>
                  <td className="roster-name" title={person.username}>
                    <span className="roster-name__label">{person.display_name}</span>
                  </td>
                  {days.map((day) => {
                    const key = `${person.id}|${day.day}`;
                    const windows = props.shift ? dayWindows(props.shift, cursor.y, cursor.m0 + 1, day.day) : null;
                    const cell = windows ? classifyDay(leaves.get(person.id) ?? [], windows) : { mark: "none" as Mark, owned: [], locked: false };
                    const busy = pending === key;
                    const blocked = !props.canWrite || !props.shift || cell.locked || pending !== null;
                    const title = cell.locked ? "Khoảng nghỉ này kéo nhiều ngày, không sửa từng ô." : !props.shift ? "Chưa có giờ ca" : TITLES[cell.mark];
                    return (
                      <td key={day.day} className={blocked ? "roster-day roster-day--blocked" : "roster-day"} onClick={() => void cycle(person, day.day)}>
                        <button
                          type="button"
                          className={`leave-dot${cell.mark === "none" ? "" : ` leave-dot--${cell.mark.toLowerCase()}`}${cell.locked ? " leave-dot--locked" : ""}${blocked ? " leave-dot--blocked" : ""}`}
                          title={title}
                          aria-disabled={blocked}
                          aria-label={`${person.display_name} ngày ${day.day}: ${TITLES[cell.mark]}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            void cycle(person, day.day);
                          }}
                        >
                          {busy ? "…" : cell.mark === "none" ? "" : cell.mark}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function monthDays(year: number, monthIndex: number): { day: number; weekday: number }[] {
  const count = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => {
    const day = index + 1;
    return { day, weekday: new Date(Date.UTC(year, monthIndex, day)).getUTCDay() };
  });
}

function shiftMonth(cursor: { y: number; m0: number }, delta: number): { y: number; m0: number } {
  const next = new Date(Date.UTC(cursor.y, cursor.m0 + delta, 1));
  return { y: next.getUTCFullYear(), m0: next.getUTCMonth() };
}

async function mapPool<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item !== undefined) {
        await task(item);
      }
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
}
