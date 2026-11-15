import { toApiUrl } from "../api.ts";
import { useTr } from "./language.tsx";

export function ChatBody(props: { taskId: string; message: { id: string; body: string; has_image?: boolean } }) {
  const tr = useTr();
  const caption = props.message.has_image && (props.message.body === "Khách gửi ảnh." || props.message.body === "Đã gửi ảnh.") ? "" : props.message.body;
  return (
    <>
      {props.message.has_image ? (
        <img className="chat-photo" alt={tr("Ảnh khách gửi", "客户发送的图片")} src={toApiUrl(`/api/v1/tasks/${props.taskId}/messages/${props.message.id}/image`)} />
      ) : null}
      {caption ? <p>{caption}</p> : null}
    </>
  );
}
