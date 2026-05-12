import { withLoader } from "../../js/loader.js";
    import { requireAdmin } from "../../js/admin/admin-auth.js";
    import { injectAdminLayout } from "../../js/admin/admin-layout.js";
    import { LS } from "../../js/config.js";
    import toast from "../../js/toast.js";

    const SEO_KEY = "zm_seo_settings";
    const DEFAULTS = {
      title: "Manarize — Premium Online Shopping in Sri Lanka",
      description: "Discover premium products from top brands. Electronics, Fashion, Clothing, Sport Shoes, Laptops and more. Fast delivery across Sri Lanka.",
      ogImage: "",
      twitterHandle: "@manarize_lk",
      googleAnalyticsId: "",
      googleSiteVerification: "",
      indexing: true,
      canonicalBase: "https://manarize.lk",
    };

    function load() {
      try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SEO_KEY)||"{}") }; } catch { return { ...DEFAULTS }; }
    }

    withLoader(async () => {
      if (!requireAdmin()) return;
      injectAdminLayout("SEO Settings");
      const seo = load();
      document.getElementById("seo-title").value = seo.title;
      document.getElementById("seo-desc").value = seo.description;
      document.getElementById("seo-og-img").value = seo.ogImage;
      document.getElementById("seo-twitter").value = seo.twitterHandle;
      document.getElementById("seo-ga").value = seo.googleAnalyticsId;
      document.getElementById("seo-gsv").value = seo.googleSiteVerification;
      document.getElementById("seo-canonical").value = seo.canonicalBase;
      document.getElementById("seo-index").checked = seo.indexing;

      // Live character counts
      ["seo-title","seo-desc"].forEach(id => {
        const el = document.getElementById(id);
        const counter = document.getElementById(id+"-count");
        if(el && counter) {
          counter.textContent = el.value.length;
          el.addEventListener("input", () => {
            counter.textContent = el.value.length;
            const max = id === "seo-title" ? 60 : 160;
            counter.style.color = el.value.length > max ? "var(--clr-error)" : "var(--clr-text-3)";
          });
        }
      });

      document.getElementById("seo-form")?.addEventListener("submit", e => {
        e.preventDefault();
        const data = {
          title: document.getElementById("seo-title").value.trim(),
          description: document.getElementById("seo-desc").value.trim(),
          ogImage: document.getElementById("seo-og-img").value.trim(),
          twitterHandle: document.getElementById("seo-twitter").value.trim(),
          googleAnalyticsId: document.getElementById("seo-ga").value.trim(),
          googleSiteVerification: document.getElementById("seo-gsv").value.trim(),
          canonicalBase: document.getElementById("seo-canonical").value.trim(),
          indexing: document.getElementById("seo-index").checked,
        };
        localStorage.setItem(SEO_KEY, JSON.stringify(data));
        toast.success("Saved!", "SEO settings updated");
      });
    });
