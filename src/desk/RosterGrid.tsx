import { LeftOutlined, ReloadOutlined, RightOutlined } from "@ant-design/icons";
import { Alert, Button, Input, Space, Spin, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "../api.ts";
import { useTr } from "./language.tsx";
import { classifyDay, dayWindows, markBody, nextMark, type Mark } from "../roster.ts";
import type { Leave, Shift } from "../types.ts";

function markCopy(mark: Mark): { vi: string; zh: string } {
  if (mark === "N") {
    return { vi: "Cả ngày", zh: "全天" };
  }
  if (mark === "S") {
    return { vi: "Nghỉ sáng", zh: "上午休息" };
  }
  if (mark === "C") {
    return { vi: "Nghỉ chiều", zh: "下午休息" };
  }
  if (mark === "K") {
    return { vi: "Không lương", zh: "无薪" };
  }
  return { vi: "Đi làm — bấm để ghi nghỉ", zh: "出勤 — 点击登记休息" };
}

type RosterPerson = {
  id: string;
  display_name: string;
  username: string;
  status: string;
};

export function RosterGrid(props: {
  shift: Shift | null;
  canList: boolean;
  canWrite: boolean;
  scope: "all" | "team";
  onUnauthorized: () => void;
  onMfaSetup: () => void;
}) {
  const tr = useTr();
  const trRef = useRef(tr);
  trRef.current = tr;
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m0: today.getMonth() });
  const [query, setQuery] = useState("");
  const [staff, setStaff] = useState<RosterPerson[]>([]);
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
      const listed = await api<{ items: RosterPerson[] }>(props.scope === "team" ? "/api/v1/team/roster" : "/api/v1/admin/staff");
      const active = listed.items.filter((person) => person.status === "active");
      const nextLeaves = new Map<string, Leave[]>();
      const failed: string[] = [];
      await mapPool(active, 6, async (person) => {
        try {
          const schedule = await api<{ leave: Leave[] }>(`/api/v1/admin/staff/${person.id}/schedule`);
          nextLeaves.set(person.id, schedule.leave);
        } catch (caught) {
          const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", trRef.current("Không tải được lịch nghỉ", "无法加载休息安排"), "");
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
      setError(failed.length ? new ApiError(0, "partial", trRef.current(`Không tải được lịch của ${failed.join(", ")}`, `无法加载 ${failed.join(", ")} 的日程`), "") : null);
    } catch (caught) {
      if (ticket !== epoch.current) {
        return;
      }
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", trRef.current("Không tải được lịch làm", "无法加载排班"), "");
      if (!failAuth(problem)) {
        setError(problem);
      }
    } finally {
      if (ticket === epoch.current) {
        setLoading(false);
      }
    }
  }, [canList, failAuth, props.scope]);

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

  async function cycle(person: RosterPerson, day: number) {
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
      setError(new ApiError(0, "shift", tr("Ca này không tách được sáng và chiều", "此班次无法拆分上午和下午"), ""));
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
          setNotice(tr(`Đã trả ${created.released_task_count} hội thoại đang mở về hàng chờ.`, `已将 ${created.released_task_count} 个进行中的会话退回队列。`));
        }
      }
      const fresh = await api<{ leave: Leave[] }>(`/api/v1/admin/staff/${person.id}/schedule`);
      setLeaves((currentLeaves) => new Map(currentLeaves).set(person.id, fresh.leave));
      setError(null);
    } catch (caught) {
      const problem = caught instanceof ApiError ? caught : new ApiError(0, "network", tr("Không lưu được ngày nghỉ", "无法保存休息日"), "");
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

  const weekday = [tr("CN", "日"), tr("T2", "一"), tr("T3", "二"), tr("T4", "三"), tr("T5", "四"), tr("T6", "五"), tr("T7", "六")];
  const legend: { mark: Mark | "O"; label: string; title: string }[] = [
    { mark: "N", label: "N", title: tr("Cả ngày", "全天") },
    { mark: "S", label: "S", title: tr("Nghỉ sáng", "上午休息") },
    { mark: "C", label: "C", title: tr("Nghỉ chiều", "下午休息") },
    { mark: "K", label: "K", title: tr("Không lương", "无薪") },
    { mark: "O", label: "O", title: tr("Ngày ngoài giờ làm", "非工作日") },
  ];
  const titles: Record<Mark, string> = {
    none: tr("Đi làm — bấm để ghi nghỉ", "出勤 — 点击登记休息"),
    N: tr("Cả ngày", "全天"),
    S: tr("Nghỉ sáng", "上午休息"),
    C: tr("Nghỉ chiều", "下午休息"),
    K: tr("Không lương", "无薪"),
  };

  return (
    <section className="roster">
      <div className="roster__bar">
        <Space wrap size={8}>
          {legend.map((item) => (
            <span key={item.mark} className={`roster-chip roster-chip--${item.mark.toLowerCase()}`}>
              {item.mark === "O" ? "○" : item.label} — {item.title}
            </span>
          ))}
        </Space>
        <Space wrap>
          <Input allowClear placeholder={tr("Tìm thành viên", "搜索成员")} value={query} onChange={(event) => setQuery(event.target.value)} style={{ width: 180 }} />
          <Button icon={<LeftOutlined />} aria-label={tr("Tháng trước", "上个月")} onClick={() => setCursor((currentCursor) => shiftMonth(currentCursor, -1))} />
          <Typography.Text strong>
            {tr(`Tháng ${cursor.m0 + 1}/${cursor.y}`, `${cursor.y}年${cursor.m0 + 1}月`)}
          </Typography.Text>
          <Button icon={<RightOutlined />} aria-label={tr("Tháng sau", "下个月")} onClick={() => setCursor((currentCursor) => shiftMonth(currentCursor, 1))} />
          <Button type="link" onClick={() => setCursor({ y: today.getFullYear(), m0: today.getMonth() })}>
            {tr("Tháng này", "本月")}
          </Button>
          <Button icon={<ReloadOutlined />} aria-label={tr("Tải lại", "刷新")} onClick={() => void load()} />
        </Space>
      </div>
      <p className="page-note" style={{ marginTop: 0 }}>
        {tr("Ô trống là đang đi làm. Bấm lần lượt: cả ngày, nghỉ sáng, nghỉ chiều, không lương, rồi về đi làm. Sáng là trước giờ nghỉ giữa ca, chiều là sau giờ nghỉ. Không có giờ nghỉ thì chia đôi ca. Mục O là ngày ngoài giờ làm; lịch này chưa có ngày nghỉ cố định nên chưa tô ô đó.", "空格表示出勤。依次点击：全天、上午休息、下午休息、无薪，然后恢复出勤。上午是班中休息之前，下午是休息之后。没有休息时间则把班次对半分开。O 表示非工作日；当前排班没有固定休息日，所以还不会标出这些格子。")}
      </p>
      {notice ? <Alert type="info" showIcon style={{ marginBottom: 12 }} message={notice} /> : null}
      {error ? <Alert type="error" showIcon style={{ marginBottom: 12 }} message={error.message} /> : null}
      {!props.canList ? <Alert type="warning" showIcon message={tr("Bạn không có quyền xem danh sách nhân viên.", "你没有查看员工列表的权限。")} /> : null}
      {!props.shift ? <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={tr("Chưa có giờ ca. Đặt giờ ca trước khi ghi nghỉ.", "尚未设置班次时间。请先设置班次时间再登记休息。")} /> : null}
      {loading ? (
        <div className="roster__loading">
          <Spin />
        </div>
      ) : null}
      {props.canList && !loading && visible.length === 0 ? (
        <Alert type="info" showIcon message={staff.length ? tr("Không có thành viên khớp.", "没有匹配的成员。") : props.scope === "team" ? tr("Chưa có nhân viên trong các đài bạn phụ trách.", "你负责的站点还没有员工。") : tr("Chưa có nhân viên đang làm.", "还没有在职员工。")} />
      ) : null}
      {props.canList && !loading && visible.length > 0 ? (
        <div className="roster-scroll">
          <table className="roster-table">
            <thead>
              <tr>
                <th className="roster-name">
                  <span className="roster-name__label">{tr("Thành viên", "成员")}</span>
                </th>
                {days.map((day) => (
                  <th key={day.day}>
                    <div>{day.day}</div>
                    <div className="roster-weekday">{weekday[day.weekday]}</div>
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
                    const title = cell.locked ? tr("Khoảng nghỉ này kéo nhiều ngày, không sửa từng ô.", "这段休息跨越多天，不能逐格修改。") : !props.shift ? tr("Chưa có giờ ca", "尚未设置班次时间") : titles[cell.mark];
                    return (
                      <td key={day.day} className={blocked ? "roster-day roster-day--blocked" : "roster-day"} onClick={() => void cycle(person, day.day)}>
                        <button
                          type="button"
                          className={`leave-dot${cell.mark === "none" ? "" : ` leave-dot--${cell.mark.toLowerCase()}`}${cell.locked ? " leave-dot--locked" : ""}${blocked ? " leave-dot--blocked" : ""}`}
                          title={title}
                          aria-disabled={blocked}
                          aria-label={tr(`${person.display_name} ngày ${day.day}: ${markCopy(cell.mark).vi}`, `${person.display_name} ${day.day}日：${markCopy(cell.mark).zh}`)}
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
