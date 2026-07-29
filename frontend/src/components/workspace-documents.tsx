"use client";

import { useState } from "react";

import { DocumentList } from "./document-list";
import { DocumentUpload } from "./document-upload";

/**
 * Upload and library, joined.
 *
 * They are paired here rather than in the page so the page can stay a server
 * component: the only client state needed is the nudge that tells the list a
 * new document exists.
 */
export function WorkspaceDocuments() {
  const [uploads, setUploads] = useState(0);

  return (
    <>
      <DocumentUpload onUploaded={() => setUploads((count) => count + 1)} />
      <DocumentList refreshToken={uploads} />
    </>
  );
}
