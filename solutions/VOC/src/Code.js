function testSnowflakeAPI() {
  const props = PropertiesService.getScriptProperties();

  const accountUrl = props
    .getProperty("SNOWFLAKE_ACCOUNT_URL")
    .replace(/\/$/, "");

  const token = props.getProperty("SNOWFLAKE_PAT");
  const warehouse = props.getProperty("SNOWFLAKE_WAREHOUSE");

  const endpoint = accountUrl + "/api/v2/statements";

  const payload = {
    statement: "SELECT CURRENT_VERSION() AS VERSION",
    timeout: 30,
    warehouse: warehouse
  };

  const response = UrlFetchApp.fetch(endpoint, {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + token,
      "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN",
      Accept: "application/json"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const result = JSON.parse(response.getContentText());

  console.log("HTTP Status: " + status);

  if (status === 200) {
    console.log("Snowflake API connection successful");
    console.log("Query ID: " + result.statementHandle);
    console.log("Rows returned: " + (result.data || []).length);
  } else {
    console.log(
      "Snowflake error: " +
      JSON.stringify(result).slice(0, 1500)
    );
  }
}