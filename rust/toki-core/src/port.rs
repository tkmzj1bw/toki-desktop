//! The Rust port of `src/lib/`.
//!
//! Replace each `unimplemented!` with the port of the source function. Return `Err` where
//! the source throws or raises: the caller gets an error there too. After changing a
//! signature, run `rust-anything refresh` to regenerate the bindings. `rust-anything diff` checks
//! behavior against what the source recorded.

#![forbid(unsafe_code)]

use serde_json::{Map, Value};

use crate::js;

fn object<'a>(value: &'a Value, name: &str) -> Result<&'a Map<String, Value>, String> {
    value
        .as_object()
        .ok_or_else(|| format!("TypeError: {name} is not an object"))
}

fn field<'a>(object: &'a Map<String, Value>, key: &str) -> Option<&'a Value> {
    object
        .get(key)
        .filter(|value| !value.is_null() && !js::is_undefined(value))
}

fn array<'a>(value: &'a Value, name: &str) -> Result<&'a Vec<Value>, String> {
    value
        .as_array()
        .ok_or_else(|| format!("TypeError: {name} is not an array"))
}

fn number(object: &Map<String, Value>, key: &str, fallback: f64) -> Result<f64, String> {
    match field(object, key) {
        None => Ok(fallback),
        Some(value) => {
            js::as_number(value).ok_or_else(|| format!("TypeError: {key} is not a number"))
        }
    }
}

fn text<'a>(object: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    field(object, key).and_then(Value::as_str)
}

fn point(value: &Value) -> Result<(f64, f64), String> {
    let object = object(value, "point")?;
    Ok((
        number(object, "x", f64::NAN)?,
        number(object, "y", f64::NAN)?,
    ))
}

fn xy(x: f64, y: f64) -> Value {
    serde_json::json!({ "x": js::number(x), "y": js::number(y) })
}

/// ECMAScript `Math.max`: NaN propagates and all zeroes collapse to +0.
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == 0.0 && b == 0.0 {
        0.0
    } else if a > b {
        a
    } else {
        b
    }
}

/// ECMAScript `Math.min`: NaN propagates and any -0 wins over +0.
fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == 0.0 && b == 0.0 {
        if a.is_sign_negative() || b.is_sign_negative() {
            -0.0
        } else {
            0.0
        }
    } else if a < b {
        a
    } else {
        b
    }
}

/// `Math.hypot`-style distance without overflow surprises.
fn distance(a: (f64, f64), b: (f64, f64)) -> f64 {
    (a.0 - b.0).hypot(a.1 - b.1)
}

fn ellipse_points(cx: f64, cy: f64, rx: f64, ry: f64, steps: usize) -> Vec<Value> {
    (0..=steps)
        .map(|i| {
            let a = (i as f64 / steps as f64) * std::f64::consts::PI * 2.0;
            xy(cx + a.cos() * rx, cy + a.sin() * ry)
        })
        .collect()
}

/// Port of `shapeToPoints` (`src/lib/geometry.ts:18`).
pub fn shape_to_points(
    shape: serde_json::Value,
    _doc: serde_json::Value,
) -> Result<Vec<serde_json::Value>, String> {
    let shape = object(&shape, "shape")?;
    let points = array(
        field(shape, "points").ok_or_else(|| "TypeError: points is not an array".to_string())?,
        "points",
    )?;
    let first = points.first().map(point).transpose()?;
    let second = points.get(1).map(point).transpose()?;

    match text(shape, "type") {
        Some("line") => match (&first, &second) {
            (Some(_), Some(_)) => Ok(vec![points[0].clone(), points[1].clone()]),
            _ => Ok(vec![]),
        },
        Some("rect") => match (first, second) {
            (Some(a), Some(b)) => {
                let x1 = js_min(a.0, b.0);
                let y1 = js_min(a.1, b.1);
                let x2 = js_max(a.0, b.0);
                let y2 = js_max(a.1, b.1);
                Ok(vec![
                    xy(x1, y1),
                    xy(x2, y1),
                    xy(x2, y2),
                    xy(x1, y2),
                    xy(x1, y1),
                ])
            }
            _ => Ok(vec![]),
        },
        Some("ellipse") => match (first, second) {
            (Some(a), Some(b)) => Ok(ellipse_points(
                (a.0 + b.0) / 2.0,
                (a.1 + b.1) / 2.0,
                (a.0 - b.0).abs() / 2.0,
                (a.1 - b.1).abs() / 2.0,
                48,
            )),
            _ => Ok(vec![]),
        },
        Some("polyline") => Ok(points.clone()),
        _ => Ok(vec![]),
    }
}

/// Port of `buildSegments` (`src/lib/geometry.ts:50`).
pub fn build_segments(doc: serde_json::Value) -> Result<Vec<serde_json::Value>, String> {
    let doc = object(&doc, "doc")?;
    let layers = array(
        field(doc, "layers").ok_or_else(|| "TypeError: layers is not an array".to_string())?,
        "layers",
    )?;
    let shapes = array(
        field(doc, "shapes").ok_or_else(|| "TypeError: shapes is not an array".to_string())?,
        "shapes",
    )?;

    let mut visible = std::collections::HashSet::new();
    for layer in layers {
        let layer = object(layer, "layer")?;
        if field(layer, "visible").and_then(Value::as_bool) == Some(true) {
            if let Some(id) = text(layer, "id") {
                visible.insert(id.to_string());
            }
        }
    }

    let mut segments = Vec::new();
    let mut pen_position = (0.0, 0.0);

    for shape in shapes {
        let shape_object = object(shape, "shape")?;
        let layer_id = text(shape_object, "layerId").unwrap_or_default();
        if !visible.contains(layer_id) {
            continue;
        }
        let points = shape_to_points(shape.clone(), serde_json::Value::Null)?;
        if points.len() < 2 {
            continue;
        }
        let first = point(&points[0])?;
        if distance(first, pen_position) > 0.01 {
            segments.push(serde_json::json!({
                "from": xy(pen_position.0, pen_position.1),
                "to": xy(first.0, first.1),
                "pen": "up",
                "shapeId": text(shape_object, "id").unwrap_or_default(),
            }));
        }
        for pair in points.windows(2) {
            let from = point(&pair[0])?;
            let to = point(&pair[1])?;
            segments.push(serde_json::json!({
                "from": xy(from.0, from.1),
                "to": xy(to.0, to.1),
                "pen": "down",
                "shapeId": text(shape_object, "id").unwrap_or_default(),
            }));
        }
        pen_position = point(points.last().expect("at least two points"))?;
    }

    Ok(segments)
}

/// Port of `clampToBed` (`src/lib/geometry.ts:107`).
pub fn clamp_to_bed(
    point_value: serde_json::Value,
    doc: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let (x, y) = point(&point_value)?;
    let doc = object(&doc, "doc")?;
    let bed = object(
        field(doc, "bed").ok_or_else(|| "TypeError: bed is not an object".to_string())?,
        "bed",
    )?;
    Ok(xy(
        js_min(number(bed, "width", f64::NAN)?, js_max(0.0, x)),
        js_min(number(bed, "height", f64::NAN)?, js_max(0.0, y)),
    ))
}

/// Port of `toGcode` (`src/lib/geometry.ts:112`).
pub fn to_gcode(doc: serde_json::Value, rig: Option<serde_json::Value>) -> Result<String, String> {
    let doc = object(&doc, "doc")?;
    let rig = rig.filter(|value| !js::is_undefined(value) && !value.is_null());
    let rig_object = rig.as_ref().map(|value| object(value, "rig")).transpose()?;

    let segments = build_segments(serde_json::Value::Object(doc.clone()))?;

    let mode = rig_object
        .and_then(|rig| text(rig, "mode"))
        .unwrap_or("plotter");
    let profile = rig_object
        .and_then(|rig| field(rig, "profiles"))
        .map(|profiles| object(profiles, "profiles"))
        .transpose()?
        .and_then(|profiles| field(profiles, mode))
        .map(|profile| object(profile, "profile"))
        .transpose()?;
    let tool = profile
        .and_then(|profile| field(profile, "tool"))
        .map(|tool| object(tool, "tool"))
        .transpose()?;

    let settings = object(
        field(doc, "settings").ok_or_else(|| "TypeError: settings is not an object".to_string())?,
        "settings",
    )?;
    let doc_bed = object(
        field(doc, "bed").ok_or_else(|| "TypeError: bed is not an object".to_string())?,
        "bed",
    )?;
    let bed = profile
        .and_then(|profile| field(profile, "bed"))
        .map(|bed| object(bed, "bed"))
        .transpose()?
        .unwrap_or(doc_bed);

    let bed_width = number(bed, "width", f64::NAN)?;
    let bed_height = number(bed, "height", f64::NAN)?;
    // `toGcode` passes `{ ...doc, bed }` (the profile bed) into `clampToBed`.
    let mut clamped_doc = doc.clone();
    clamped_doc.insert("bed".to_string(), serde_json::Value::Object(bed.clone()));
    let clamped_doc = serde_json::Value::Object(clamped_doc);
    let safe_z = tool
        .and_then(|tool| field(tool, "safeZ"))
        .map(|value| {
            js::as_number(value).ok_or_else(|| "TypeError: safeZ is not a number".to_string())
        })
        .transpose()?
        .unwrap_or_else(|| number(settings, "penUp", f64::NAN).unwrap_or(f64::NAN));
    let work_z = tool
        .and_then(|tool| field(tool, "workZ"))
        .map(|value| {
            js::as_number(value).ok_or_else(|| "TypeError: workZ is not a number".to_string())
        })
        .transpose()?
        .unwrap_or_else(|| number(settings, "penDown", f64::NAN).unwrap_or(f64::NAN));

    let doc_travel = number(settings, "travelRate", f64::NAN)?;
    let doc_feed = number(settings, "feedRate", f64::NAN)?;
    let travel_rate = match profile {
        Some(profile) => js_min(doc_travel, number(profile, "travelRateMax", doc_travel)?),
        None => doc_travel,
    };
    let feed_rate = match profile {
        Some(profile) => js_min(doc_feed, number(profile, "feedRateMax", doc_feed)?),
        None => doc_feed,
    };

    let label = match mode {
        "plotter" => "PEN PLOTTER",
        "printer3d" => "IMPRESSORA 3D",
        "cnc" => "CNC / FUSO",
        _ => "undefined",
    };
    let n = js::number_to_string;
    let mut lines = vec![
        format!("; TOKI — {label} · traço vetorial"),
        format!(
            "; Bed {}x{} mm · Z seguro {} / trabalho {}",
            n(bed_width),
            n(bed_height),
            n(safe_z),
            n(work_z)
        ),
        "G21".to_string(),
        "G90".to_string(),
        format!("G0 Z{} F{}", n(safe_z), n(travel_rate)),
    ];

    let acknowledged = rig_object
        .and_then(|rig| field(rig, "acknowledged"))
        .map(|acks| object(acks, "acknowledged"))
        .transpose()?;
    let ack = |key: &str| -> bool {
        acknowledged
            .and_then(|acks| field(acks, key))
            .and_then(Value::as_bool)
            .unwrap_or(false)
    };

    if mode == "printer3d" {
        if let Some(tool) = tool {
            let can_heat = ack("thermalRunaway");
            lines.push(if can_heat {
                format!("M104 S{}", n(number(tool, "nozzleTarget", f64::NAN)?))
            } else {
                "; M104 BLOQUEADO: confirme thermal runaway na rig".to_string()
            });
            lines.push(if can_heat {
                format!("M140 S{}", n(number(tool, "bedTarget", f64::NAN)?))
            } else {
                "; M140 BLOQUEADO: confirme thermal runaway na rig".to_string()
            });
            lines.push("; Sem comandos E: extrusão manual em MACHINE CONTROL".to_string());
        }
    }

    if mode == "cnc" {
        if let Some(tool) = tool {
            let spindle_enabled =
                field(tool, "spindleEnabled").and_then(Value::as_bool) == Some(true);
            let cnc_ready =
                spindle_enabled && ack("spindleFirmware") && ack("enclosure") && ack("workholding");
            lines.push(if cnc_ready {
                format!("M3 S{}", n(number(tool, "rpmDefault", f64::NAN)?))
            } else {
                "; M3/M4 BLOQUEADO: confirme firmware, envelope e fixação na rig".to_string()
            });
        }
    }

    for segment in &segments {
        let segment = object(segment, "segment")?;
        let to_value =
            field(segment, "to").ok_or_else(|| "TypeError: to is missing".to_string())?;
        let to_point = point(to_value)?;
        let clamped = point(&clamp_to_bed(
            serde_json::Value::Object(
                [("x", js::number(to_point.0)), ("y", js::number(to_point.1))]
                    .into_iter()
                    .map(|(k, v)| (k.to_string(), v))
                    .collect(),
            ),
            clamped_doc.clone(),
        )?)?;
        let x = n(round(clamped.0, Some(3.0))?);
        let y = n(round(clamped.1, Some(3.0))?);
        lines.push(format!("G0 X{x} Y{y} Z{} F{}", n(safe_z), n(travel_rate)));
        if text(segment, "pen") == Some("down") {
            let plunge = n(js_max(60.0, js::math_round(travel_rate / 2.0)));
            lines.push(format!("G1 Z{} F{plunge}", n(work_z)));
            lines.push(format!("G1 X{x} Y{y} F{}", n(feed_rate)));
            lines.push(format!("G0 Z{} F{}", n(safe_z), n(travel_rate)));
        }
    }

    if mode == "printer3d" {
        lines.extend(["M104 S0".to_string(), "M140 S0".to_string()]);
    }
    if mode == "cnc" {
        lines.push("M5".to_string());
    }
    lines.extend(["M114".to_string(), "; END".to_string()]);
    Ok(lines.join("\n"))
}

/// Port of `round` (`src/lib/utils.ts:7`).
pub fn round(value: f64, digits: Option<f64>) -> Result<f64, String> {
    let digits = digits.unwrap_or(2.0);
    // `10 ** digits` is exact for integer exponents in V8; `powi` avoids exp/log drift.
    let factor = if digits.fract() == 0.0 && digits.abs() <= i32::MAX as f64 {
        10f64.powi(digits as i32)
    } else {
        10f64.powf(digits)
    };
    Ok(js::math_round(value * factor) / factor)
}
