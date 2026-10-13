export function getMessageText(data) {
  return typeof data?.text?.content === "string" ? data.text.content.trim() : "";
}

export function shouldHandleMessage(data) {
  if (data?.msgtype !== "text" || !getMessageText(data)) return false;
  if (data.conversationType === "2") return data.isInAtList === true;
  return data.conversationType === "1";
}
