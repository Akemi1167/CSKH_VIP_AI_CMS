import { toApiUrl } from "../api.ts";

export function ChatBody(props: { taskId: string; message: { id: string; body: string; has_image?: boolean } }) {
  const caption = props.message.has_image && (props.message.body === "Khách gửi ảnh." || props.message.body === "Đã gửi ảnh.") ? "" : props.message.body;
  return (
    <>
      {props.message.has_image ? (
        <img className="chat-photo" alt="Ảnh khách gửi" src={toApiUrl(`/api/v1/tasks/${props.taskId}/messages/${props.message.id}/image`)} />
      ) : null}
      {caption ? <p>{caption}</p> : null}
    </>
  );
}
