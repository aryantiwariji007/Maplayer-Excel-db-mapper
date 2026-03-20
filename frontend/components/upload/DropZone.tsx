import { useCallback, useState, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, File, X, CloudUpload, FolderUp } from "lucide-react";

interface FileWithStatus {
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  progress: number;
}

interface DropZoneProps {
  onFilesAccepted: (files: File[]) => void;
  uploading: boolean;
}

export default function DropZone({ onFilesAccepted, uploading }: DropZoneProps) {
  const [queued, setQueued] = useState<FileWithStatus[]>([]);

  const onDrop = useCallback(
    (accepted: File[]) => {
      // Filter out hidden files or unsupported extensions that might sneak in via folder drop
      const validFiles = accepted.filter(f => 
        !f.name.startsWith('.') && 
        (f.name.endsWith('.csv') || f.name.endsWith('.xls') || f.name.endsWith('.xlsx') || f.name.endsWith('.zip'))
      );

      const newFiles = validFiles.map((f) => ({
        file: f,
        status: "pending" as const,
        progress: 0,
      }));
      setQueued((prev) => [...prev, ...newFiles]);
      onFilesAccepted(validFiles);
    },
    [onFilesAccepted]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "application/vnd.ms-excel": [".xls"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/zip": [".zip"],
      "application/x-zip-compressed": [".zip"],
    },
    multiple: true,
    disabled: uploading,
  });

  const remove = (idx: number) =>
    setQueued((prev) => prev.filter((_, i) => i !== idx));

  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const fileArray = Array.from(e.target.files);
      onDrop(fileArray);
      // Reset input so the same folder can be selected again if needed
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  };

  return (
    <div>
      <div
        {...getRootProps()}
        className={`dropzone ${isDragActive ? "active" : ""}`}
        style={{ opacity: uploading ? 0.6 : 1 }}
      >
        <input {...getInputProps()} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 56, height: 56, borderRadius: "50%",
            background: "linear-gradient(135deg, rgba(167,139,250,0.2) 0%, rgba(96,165,250,0.15) 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <CloudUpload size={26} color="#a78bfa" />
          </div>
          <div>
            <p style={{ fontSize: 16, fontWeight: 600, color: "hsl(220 20% 90%)", marginBottom: 4 }}>
              {isDragActive ? "Drop files here…" : "Drag & drop files/folders here"}
            </p>
            <p style={{ fontSize: 13, color: "hsl(220 10% 55%)" }}>
              CSV, XLS, XLSX, ZIP supported · Folders OK
            </p>
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
            <button
              type="button"
              className="btn-gradient"
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <Upload size={14} /> Browse Files
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                folderInputRef.current?.click();
              }}
              style={{ 
                display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", 
                borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer", 
                border: "1px solid hsl(220 15% 30%)", background: "hsl(220 15% 15%)", 
                color: "hsl(220 20% 90%)", transition: "all 0.15s" 
              }}
            >
              <FolderUp size={14} /> Browse Folder
            </button>
            <input 
              type="file" 
              style={{ display: "none" }} 
              ref={folderInputRef} 
              onChange={handleFolderSelect} 
              {...{ webkitdirectory: "", directory: "" } as any} 
              multiple 
            />
          </div>
        </div>
      </div>

      {queued.length > 0 && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {queued.map((item, idx) => (
            <div
              key={idx}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                background: "hsl(220 15% 10%)", border: "1px solid hsl(220 15% 18%)",
                borderRadius: 10, padding: "10px 14px",
              }}
            >
              <File size={16} color="#a78bfa" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: "hsl(220 20% 90%)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.file.name}
                </p>
                <p style={{ fontSize: 11, color: "hsl(220 10% 50%)" }}>
                  {(item.file.size / 1024).toFixed(1)} KB · {item.status}
                </p>
              </div>
              <button
                onClick={() => remove(idx)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(220 10% 45%)", display: "flex", alignItems: "center" }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
