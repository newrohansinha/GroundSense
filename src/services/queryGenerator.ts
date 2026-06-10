type Entity = {
  entity_type: string;
  entity_value: string;
};

type SupplierExposure = {
  supplier_name?: string;
  country?: string;
  supplied_input?: string;
  spend_percent?: number | null;
};

type CustomerExposure = {
  customer_name?: string;
  product_line?: string;
  revenue_percent?: number | null;
  contract_notes?: string;
};

type CommodityExposure = {
  commodity?: string;
  spend_percent?: number | null;
  annual_spend_estimate?: number | null;
  notes?: string;
};

type Facility = {
  facility_name?: string;
  city?: string;
  state?: string;
  country?: string;
  function?: string;
};

export type GeneratedQuery = {
  query_text: string;
  query_type: string;
};

export type QueryModelInput = {
  entities: Entity[];
  industry: string;
  suppliers?: SupplierExposure[];
  customers?: CustomerExposure[];
  commodities?: CommodityExposure[];
  facilities?: Facility[];
};

function clean(value: string | undefined | null) {
  return (value || "").trim();
}

function quote(value: string) {
  const cleaned = clean(value);
  if (!cleaned) return "";
  return `"${cleaned}"`;
}

function addQuery(
  queries: GeneratedQuery[],
  seen: Set<string>,
  queryText: string,
  queryType: string
) {
  const cleaned = queryText.replace(/\s+/g, " ").trim();

  if (!cleaned) return;

  const key = `${queryType}:${cleaned.toLowerCase()}`;

  if (seen.has(key)) return;

  seen.add(key);

  queries.push({
    query_text: cleaned,
    query_type: queryType,
  });
}

export function generateQueries(model: QueryModelInput) {
  const queries: GeneratedQuery[] = [];
  const seen = new Set<string>();

  const entities = model.entities || [];
  const industry = clean(model.industry);

  const countries = entities
    .filter((entity) => entity.entity_type === "supplier_country")
    .map((entity) => clean(entity.entity_value))
    .filter(Boolean);

  const competitors = entities
    .filter((entity) => entity.entity_type === "competitor")
    .map((entity) => clean(entity.entity_value))
    .filter(Boolean);

  const products = entities
    .filter((entity) => entity.entity_type === "product_line")
    .map((entity) => clean(entity.entity_value))
    .filter(Boolean);

  const customerSegments = entities
    .filter((entity) => entity.entity_type === "customer_segment")
    .map((entity) => clean(entity.entity_value))
    .filter(Boolean);

  const costDrivers = entities
    .filter((entity) => entity.entity_type === "cost_driver")
    .map((entity) => clean(entity.entity_value))
    .filter(Boolean);

  const suppliers = model.suppliers || [];
  const customers = model.customers || [];
  const commodities = model.commodities || [];
  const facilities = model.facilities || [];

  for (const supplier of suppliers) {
    const supplierName = clean(supplier.supplier_name);
    const supplierCountry = clean(supplier.country);
    const suppliedInput = clean(supplier.supplied_input);

    if (supplierName) {
      addQuery(queries, seen, `${quote(supplierName)} bankruptcy`, "supplier_exact");
      addQuery(queries, seen, `${quote(supplierName)} production outage`, "supplier_exact");
      addQuery(queries, seen, `${quote(supplierName)} strike`, "supplier_exact");
      addQuery(queries, seen, `${quote(supplierName)} disruption`, "supplier_exact");
    }

    if (supplierCountry && suppliedInput) {
      addQuery(
        queries,
        seen,
        `${supplierCountry} ${suppliedInput} supply disruption`,
        "supplier_country_input"
      );

      addQuery(
        queries,
        seen,
        `${supplierCountry} ${suppliedInput} tariffs`,
        "supplier_country_input"
      );

      addQuery(
        queries,
        seen,
        `${supplierCountry} ${suppliedInput} prices`,
        "supplier_country_input"
      );
    }
  }

  for (const competitor of competitors) {
    addQuery(queries, seen, `${quote(competitor)} acquisition`, "competitor_exact");
    addQuery(queries, seen, `${quote(competitor)} earnings`, "competitor_exact");
    addQuery(queries, seen, `${quote(competitor)} distribution center`, "competitor_exact");
    addQuery(queries, seen, `${quote(competitor)} expansion`, "competitor_exact");
    addQuery(queries, seen, `${quote(competitor)} contract award`, "competitor_exact");
    addQuery(queries, seen, `${quote(competitor)} layoffs`, "competitor_exact");
    addQuery(queries, seen, `${quote(competitor)} pricing`, "competitor_exact");
  }

  for (const customer of customers) {
    const customerName = clean(customer.customer_name);
    const productLine = clean(customer.product_line);

    if (customerName) {
      addQuery(queries, seen, `${quote(customerName)} production cuts`, "customer_exact");
      addQuery(queries, seen, `${quote(customerName)} supplier disruption`, "customer_exact");
      addQuery(queries, seen, `${quote(customerName)} contract award`, "customer_exact");
      addQuery(queries, seen, `${quote(customerName)} plant shutdown`, "customer_exact");
    }

    if (customerName && productLine) {
      addQuery(
        queries,
        seen,
        `${quote(customerName)} ${productLine} supplier`,
        "customer_product"
      );
    }
  }

  for (const commodity of commodities) {
    const commodityName = clean(commodity.commodity);

    if (!commodityName) continue;

    addQuery(queries, seen, `${commodityName} prices`, "commodity");
    addQuery(queries, seen, `${commodityName} shortage`, "commodity");
    addQuery(queries, seen, `${commodityName} tariffs`, "commodity");
    addQuery(queries, seen, `${commodityName} imports`, "commodity");
    addQuery(queries, seen, `${commodityName} futures`, "commodity");
    addQuery(queries, seen, `${commodityName} supply disruption`, "commodity");

    for (const country of countries) {
      addQuery(queries, seen, `${country} ${commodityName} tariffs`, "country_commodity");
      addQuery(queries, seen, `${country} ${commodityName} exports`, "country_commodity");
      addQuery(queries, seen, `${country} ${commodityName} supply`, "country_commodity");
    }
  }

  for (const country of countries) {
    addQuery(queries, seen, `${country} manufacturing disruption`, "country");
    addQuery(queries, seen, `${country} tariffs`, "country");
    addQuery(queries, seen, `${country} trade policy`, "country");
    addQuery(queries, seen, `${country} labor costs manufacturing`, "country");
    addQuery(queries, seen, `${country} freight rates`, "country");
    addQuery(queries, seen, `${country} supply chain disruption`, "country");
    addQuery(queries, seen, `${country} factory shutdown`, "country");
  }

  for (const facility of facilities) {
    const city = clean(facility.city);
    const country = clean(facility.country);
    const facilityFunction = clean(facility.function);

    if (city && facilityFunction) {
      addQuery(queries, seen, `${city} ${facilityFunction} disruption`, "facility");
      addQuery(queries, seen, `${city} labor strike manufacturing`, "facility");
    }

    if (country && facilityFunction) {
      addQuery(queries, seen, `${country} ${facilityFunction} tariffs`, "facility");
    }
  }

  for (const product of products) {
    addQuery(queries, seen, `${quote(product)} demand`, "product");
    addQuery(queries, seen, `${quote(product)} supplier`, "product");
    addQuery(queries, seen, `${quote(product)} contract`, "product");
    addQuery(queries, seen, `${quote(product)} automotive`, "product");
  }

  for (const segment of customerSegments) {
    addQuery(queries, seen, `${segment} demand outlook`, "customer_segment");
    addQuery(queries, seen, `${segment} production cuts`, "customer_segment");
    addQuery(queries, seen, `${segment} supplier disruption`, "customer_segment");
  }

  for (const driver of costDrivers) {
    addQuery(queries, seen, `${driver}`, "cost_driver");
    addQuery(queries, seen, `${driver} increase`, "cost_driver");
    addQuery(queries, seen, `${driver} outlook`, "cost_driver");
  }

  if (industry) {
    addQuery(queries, seen, `${industry} supply chain`, "industry");
    addQuery(queries, seen, `${industry} regulation`, "industry");
    addQuery(queries, seen, `${industry} pricing pressure`, "industry");
    addQuery(queries, seen, `${industry} tariffs`, "industry");
    addQuery(queries, seen, `${industry} supplier disruption`, "industry");
    addQuery(queries, seen, `${industry} production cuts`, "industry");
    addQuery(queries, seen, `${industry} demand outlook`, "industry");
  }

  addQuery(queries, seen, "industrial distribution tariffs", "broad_signal");
  addQuery(queries, seen, "industrial distribution freight costs", "broad_signal");
  addQuery(queries, seen, "fastener tariffs", "broad_signal");
  addQuery(queries, seen, "steel fastener tariffs", "broad_signal");
  addQuery(queries, seen, "industrial supply chain disruption", "broad_signal");
  addQuery(queries, seen, "manufacturing labor strike", "broad_signal");
  addQuery(queries, seen, "north america freight rates manufacturing", "broad_signal");
  addQuery(queries, seen, "china export restrictions industrial", "broad_signal");
  addQuery(queries, seen, "mexico manufacturing disruption", "broad_signal");
  addQuery(queries, seen, "vietnam manufacturing disruption", "broad_signal");

  return queries.slice(0, 200);
}