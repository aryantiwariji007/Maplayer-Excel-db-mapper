import { redirect } from "next/navigation";

export default function PdfExtractRedirect() {
  redirect("/upload");
}
