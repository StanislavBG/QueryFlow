import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type DocumentInput } from "@shared/routes";

export function useDocuments() {
  return useQuery({
    queryKey: [api.documents.list.path],
    queryFn: async () => {
      const res = await fetch(api.documents.list.path);
      if (!res.ok) throw new Error("Failed to fetch documents");
      return api.documents.list.responses[200].parse(await res.json());
    },
  });
}

export function useCreateDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: DocumentInput) => {
      // Validate input before sending using the shared schema
      const validated = api.documents.create.input.parse(data);
      
      const res = await fetch(api.documents.create.path, {
        method: api.documents.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
      });
      
      if (!res.ok) {
        if (res.status === 400) {
          const error = api.documents.create.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error("Failed to create document");
      }
      
      return api.documents.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.documents.list.path] });
    },
  });
}
