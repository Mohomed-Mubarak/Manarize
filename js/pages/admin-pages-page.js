import { withLoader } from "../../js/loader.js";
    import { requireAdmin } from "../../js/admin/admin-auth.js";
    import { injectAdminLayout } from "../../js/admin/admin-layout.js";
    withLoader(async () => {
      if (!requireAdmin()) return;
      injectAdminLayout("Page Manager");
    });
