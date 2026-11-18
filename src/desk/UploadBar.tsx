import { useUploadTasks, dismissUpload } from "./uploadImage.ts";
import { useTr } from "./language.tsx";

export function UploadBar() {
  const tr = useTr();
  const tasks = useUploadTasks();
  if (tasks.length === 0) {
    return null;
  }
  const running = tasks.filter((task) => task.status === "running");
  const percent = running.length === 0 ? 100 : Math.round(running.reduce((sum, task) => sum + task.progress, 0) / running.length);
  return (
    <aside className="upload-bar" aria-live="polite">
      {running.length > 0 ? (
        <div className="upload-bar__meter">
          <span style={{ width: `${Math.max(percent, 4)}%` }} />
        </div>
      ) : null}
      <div className="upload-bar__body">
        <strong>{running.length > 0 ? tr(`Đang tải ${running.length} ảnh · ${percent}%`, `正在上传 ${running.length} 张 · ${percent}%`) : tr("Ảnh vừa tải", "刚上传的图片")}</strong>
        <ul>
          {tasks.slice(0, 4).map((task) => (
            <li key={task.id} data-status={task.status}>
              <span>{task.status === "error" ? task.message : task.name}</span>
              {task.status === "running" ? <em>{task.progress}%</em> : null}
              {task.status === "error" ? (
                <button type="button" onClick={() => dismissUpload(task.id)}>
                  {tr("Đóng", "关闭")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
