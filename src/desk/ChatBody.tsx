import { toApiUrl } from "../api.ts";
import { useTr } from "./language.tsx";

export function ChatBody(props: { taskId: string; message: { id: string; body: string; has_image?: boolean; image_url?: string } }) {
  const tr = useTr();
  const caption = props.message.has_image && (props.message.body === "Khách gửi ảnh." || props.message.body === "Đã gửi ảnh.") ? "" : props.message.body;
  const image = props.message.image_url || (props.message.has_image ? toApiUrl(`/api/v1/tasks/${props.taskId}/messages/${props.message.id}/image`) : "");
  return (
    <>
      {image ? (
        <img className="chat-photo" alt={tr("Ảnh khách gửi", "客户发送的图片")} src={image} />
      ) : null}
      {caption ? <p>{caption}</p> : null}
    </>
  );
}
