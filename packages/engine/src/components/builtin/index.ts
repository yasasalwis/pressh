import type { ComponentRegistry } from "../registry.js";

// Original components
import { heroComponent }          from "./hero.js";
import { featureGridComponent }   from "./feature-grid.js";
import { ctaBannerComponent }     from "./cta-banner.js";
import { textContentComponent }   from "./text-content.js";
import { imageBlockComponent }    from "./image-block.js";
import { testimonialComponent }   from "./testimonial.js";
import { statsRowComponent }      from "./stats-row.js";
import { columnsComponent }       from "./columns.js";
import { spacerComponent }        from "./spacer.js";
import { recentPostsComponent }   from "./recent-posts.js";

// Layout & navigation
import { navHeaderComponent }     from "./nav-header.js";
import { siteFooterComponent }    from "./site-footer.js";
import { bannerStripComponent }   from "./banner-strip.js";

// Marketing / content
import { pricingTableComponent }  from "./pricing-table.js";
import { faqListComponent }       from "./faq-list.js";
import { teamGridComponent }      from "./team-grid.js";
import { logoCloudComponent }     from "./logo-cloud.js";
import { newsletterSignupComponent } from "./newsletter-signup.js";
import { iconListComponent }      from "./icon-list.js";
import { twoColFeatureComponent } from "./two-col-feature.js";
import { quoteBlockComponent }    from "./quote-block.js";

// Media
import { videoEmbedComponent }    from "./video-embed.js";
import { galleryComponent }       from "./gallery.js";

// Forms
import { contactFormComponent }   from "./contact-form.js";

export function registerBuiltinComponents(registry: ComponentRegistry): void {
  // Layout & navigation (render first in palette)
  registry.register(navHeaderComponent);
  registry.register(bannerStripComponent);
  registry.register(siteFooterComponent);
  registry.register(spacerComponent);

  // Hero / above-fold
  registry.register(heroComponent);

  // Content blocks
  registry.register(featureGridComponent);
  registry.register(twoColFeatureComponent);
  registry.register(textContentComponent);
  registry.register(quoteBlockComponent);
  registry.register(columnsComponent);
  registry.register(iconListComponent);

  // Social proof & trust
  registry.register(testimonialComponent);
  registry.register(statsRowComponent);
  registry.register(logoCloudComponent);
  registry.register(teamGridComponent);

  // Marketing
  registry.register(pricingTableComponent);
  registry.register(ctaBannerComponent);
  registry.register(faqListComponent);
  registry.register(newsletterSignupComponent);

  // Media
  registry.register(imageBlockComponent);
  registry.register(galleryComponent);
  registry.register(videoEmbedComponent);

  // Forms & data
  registry.register(contactFormComponent);
  registry.register(recentPostsComponent);
}

export {
  heroComponent,
  featureGridComponent,
  ctaBannerComponent,
  textContentComponent,
  imageBlockComponent,
  testimonialComponent,
  statsRowComponent,
  columnsComponent,
  spacerComponent,
  recentPostsComponent,
  navHeaderComponent,
  siteFooterComponent,
  bannerStripComponent,
  pricingTableComponent,
  faqListComponent,
  teamGridComponent,
  logoCloudComponent,
  newsletterSignupComponent,
  iconListComponent,
  twoColFeatureComponent,
  quoteBlockComponent,
  videoEmbedComponent,
  galleryComponent,
  contactFormComponent,
};
