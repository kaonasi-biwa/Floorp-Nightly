/*!
Backend for [MSL][msl] (Metal Shading Language).

## Binding model

Metal's bindings are flat per resource. Since there isn't an obvious mapping
from SPIR-V's descriptor sets, we require a separate mapping provided in the options.
This mapping may have one or more resource end points for each descriptor set + index
pair.

## Entry points

Even though MSL and our IR appear to be similar in that the entry points in both can
accept arguments and return values, the restrictions are different.
MSL allows the varyings to be either in separate arguments, or inside a single
`[[stage_in]]` struct. We gather input varyings and form this artificial structure.
We also add all the (non-Private) globals into the arguments.

At the beginning of the entry point, we assign the local constants and re-compose
the arguments as they are declared on IR side, so that the rest of the logic can
pretend that MSL doesn't have all the restrictions it has.

For the result type, if it's a structure, we re-compose it with a temporary value
holding the result.

[msl]: https://developer.apple.com/metal/Metal-Shading-Language-Specification.pdf
*/

use crate::{arena::Handle, proc::index, valid::ModuleInfo};
use std::{
    fmt::{Error as FmtError, Write},
    ops,
};

mod keywords;
pub mod sampler;
mod writer;

pub use writer::Writer;

pub type Slot = u8;
pub type InlineSamplerIndex = u8;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serialize", derive(serde::Serialize))]
#[cfg_attr(feature = "deserialize", derive(serde::Deserialize))]
pub enum BindSamplerTarget {
    Resource(Slot),
    Inline(InlineSamplerIndex),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serialize", derive(serde::Serialize))]
#[cfg_attr(feature = "deserialize", derive(serde::Deserialize))]
#[cfg_attr(any(feature = "serialize", feature = "deserialize"), serde(default))]
pub struct BindTarget {
    pub buffer: Option<Slot>,
    pub texture: Option<Slot>,
    pub sampler: Option<BindSamplerTarget>,
    /// If the binding is an unsized binding array, this overrides the size.
    pub binding_array_size: Option<u32>,
    pub mutable: bool,
}

// Using `BTreeMap` instead of `HashMap` so that we can hash itself.
pub type BindingMap = std::collections::BTreeMap<crate::ResourceBinding, BindTarget>;

#[derive(Clone, Debug, Default, Hash, Eq, PartialEq)]
#[cfg_attr(feature = "serialize", derive(serde::Serialize))]
#[cfg_attr(feature = "deserialize", derive(serde::Deserialize))]
#[cfg_attr(any(feature = "serialize", feature = "deserialize"), serde(default))]
pub struct PerStageResources {
    pub resources: BindingMap,

    pub push_constant_buffer: Option<Slot>,

    /// The slot of a buffer that contains an array of `u32`,
    /// one for the size of each bound buffer that contains a runtime array,
    /// in order of [`crate::GlobalVariable`] declarations.
    pub sizes_buffer: Option<Slot>,
}

#[derive(Clone, Debug, Default, Hash, Eq, PartialEq)]
#[cfg_attr(feature = "serialize", derive(serde::Serialize))]
#[cfg_attr(feature = "deserialize", derive(serde::Deserialize))]
#[cfg_attr(any(feature = "serialize", feature = "deserialize"), serde(default))]
pub struct PerStageMap {
    pub vs: PerStageResources,
    pub fs: PerStageResources,
    pub cs: PerStageResources,
}

impl ops::Index<crate::ShaderStage> for PerStageMap {
    type Output = PerStageResources;
    fn index(&self, stage: crate::ShaderStage) -> &PerStageResources {
        match stage {
            crate::ShaderStage::Vertex => &self.vs,
            crate::ShaderStage::Fragment => &self.fs,
            crate::ShaderStage::Compute => &self.cs,
        }
    }
}

enum ResolvedBinding {
    BuiltIn(crate::BuiltIn),
    Attribute(u32),
    Color(u32),
    User {
        prefix: &'static str,
        index: u32,
        interpolation: Option<ResolvedInterpolation>,
    },
    Resource(BindTarget),
}

#[derive(Copy, Clone)]
enum ResolvedInterpolation {
    CenterPerspective,
    CenterNoPerspective,
    CentroidPerspective,
    CentroidNoPerspective,
    SamplePerspective,
    SampleNoPerspective,
    Flat,
}

// Note: some of these should be removed in favor of proper IR validation.

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Format(#[from] FmtError),
    #[error("bind target {0:?} is empty")]
    UnimplementedBindTarget(BindTarget),
    #[error("composing of {0:?} is not implemented yet")]
    UnsupportedCompose(Handle<crate::Type>),
    #[error("operation {0:?} is not implemented yet")]
    UnsupportedBinaryOp(crate::BinaryOperator),
    #[error("standard function '{0}' is not implemented yet")]
    UnsupportedCall(String),
    #[error("feature '{0}' is not implemented yet")]
    FeatureNotImplemented(String),
    #[error("module is not valid")]
    Validation,
    #[error("BuiltIn {0:?} is not supported")]
    UnsupportedBuiltIn(crate::BuiltIn),
    #[error("capability {0:?} is not supported")]
    CapabilityNotSupported(crate::valid::Capabilities),
    #[error("address space {0:?} is not supported for target MSL version")]
    UnsupportedAddressSpace(crate::AddressSpace),
    #[error("attribute '{0}' is not supported for target MSL version")]
    UnsupportedAttribute(String),
}

#[derive(Clone, Debug, PartialEq, thiserror::Error)]
#[cfg_attr(feature = "serialize", derive(serde::Serialize))]
#[cfg_attr(feature = "deserialize", derive(serde::Deserialize))]
pub enum EntryPointError {
    #[error("global '{0}' doesn't have a binding")]
    MissingBinding(String),
    #[error("mapping of {0:?} is missing")]
    MissingBindTarget(crate::ResourceBinding),
    #[error("mapping for push constants is missing")]
    MissingPushConstants,
    #[error("mapping for sizes buffer is missing")]
    MissingSizesBuffer,
}

/// Points in the MSL code where we might emit a pipeline input or output.
///
/// Note that, even though vertex shaders' outputs are always fragment
/// shaders' inputs, we still need to distinguish `VertexOutput` and
/// `FragmentInput`, since there are certain differences in the way
/// [`ResolvedBinding`s] are represented on either side.
///
/// [`ResolvedBinding`s]: ResolvedBinding
#[derive(Clone, Copy, Debug)]
enum LocationMode {
    /// Input to the vertex shader.
    VertexInput,

    /// Output from the vertex shader.
    VertexOutput,

    /// Input to the fragment shader.
    FragmentInput,

    /// Output from the fragment shader.
    FragmentOutput,

    /// Compute shader input or output.
    Uniform,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
#[cfg_attr(feature = "serialize", derive(serde::Serialize))]
#[cfg_attr(feature = "deserialize", derive(serde::Deserialize))]
pub struct Options {
    /// (Major, Minor) target version of the Metal Shading Language.
    pub lang_version: (u8, u8),
    /// Map of per-stage resources to slots.
    pub per_stage_map: PerStageMap,
    /// Samplers to be inlined into the code.
    pub inline_samplers: Vec<sampler::InlineSampler>,
    /// Make it possible to link different stages via SPIRV-Cross.
    pub spirv_cross_compatibility: bool,
    /// Don't panic on missing bindings, instead generate invalid MSL.
    pub fake_missing_bindings: bool,
    /// Bounds checking policies.
    #[cfg_attr(feature = "deserialize", serde(default))]
    pub bounds_check_policies: index::BoundsCheckPolicies,
    /// Should workgroup variables be zero initialized (by polyfilling)?
    pub zero_initialize_workgroup_memory: bool,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            lang_version: (2, 0),
            per_stage_map: PerStageMap::default(),
            inline_samplers: Vec::new(),
            spirv_cross_compatibility: false,
            fake_missing_bindings: true,
            bounds_check_policies: index::BoundsCheckPolicies::default(),
            zero_initialize_workgroup_memory: true,
        }
    }
}

/// A subset of options that are meant to be changed per pipeline.
#[derive(Debug, Default, Clone, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serialize", derive(serde::Serialize))]
#[cfg_attr(feature = "deserialize", derive(serde::Deserialize))]
pub struct PipelineOptions {
    /// Allow `BuiltIn::PointSize` in the vertex shader.
    ///
    /// Metal doesn't like this for non-point primitive topologies.
    pub allow_point_size: bool,
}

impl Options {
    fn resolve_local_binding(
        &self,
        binding: &crate::Binding,
        mode: LocationMode,
    ) -> Result<ResolvedBinding, Error> {
        match *binding {
            crate::Binding::BuiltIn(mut built_in) => {
                if let crate::BuiltIn::Position { ref mut invariant } = built_in {
                    if *invariant && self.lang_version < (2, 1) {
                        return Err(Error::UnsupportedAttribute("invariant".to_string()));
                    }

                    // The 'invariant' attribute may only appear on vertex
                    // shader outputs, not fragment shader inputs.
                    if !matches!(mode, LocationMode::VertexOutput) {
                        *invariant = false;
                    }
                }

                Ok(ResolvedBinding::BuiltIn(built_in))
            }
            crate::Binding::Location {
                location,
                interpolation,
                sampling,
            } => match mode {
                LocationMode::VertexInput => Ok(ResolvedBinding::Attribute(location)),
                LocationMode::FragmentOutput => Ok(ResolvedBinding::Color(location)),
                LocationMode::VertexOutput | LocationMode::FragmentInput => {
                    Ok(ResolvedBinding::User {
                        prefix: if self.spirv_cross_compatibility {
                            "locn"
                        } else {
                            "loc"
                        },
                        index: location,
                        interpolation: {
                            // unwrap: The verifier ensures that vertex shader outputs and fragment
                            // shader inputs always have fully specified interpolation, and that
                            // sampling is `None` only for Flat interpolation.
                            let interpolation = interpolation.unwrap();
                            let sampling = sampling.unwrap_or(crate::Sampling::Center);
                            Some(ResolvedInterpolation::from_binding(interpolation, sampling))
                        },
                    })
                }
                LocationMode::Uniform => {
                    log::error!(
                        "Unexpected Binding::Location({}) for the Uniform mode",
                        location
                    );
                    Err(Error::Validation)
                }
            },
        }
    }

    fn resolve_resource_binding(
        &self,
        stage: crate::ShaderStage,
        res_binding: &crate::ResourceBinding,
    ) -> Result<ResolvedBinding, EntryPointError> {
        match self.per_stage_map[stage].resources.get(res_binding) {
            Some(target) => Ok(ResolvedBinding::Resource(target.clone())),
            None if self.fake_missing_bindings => Ok(ResolvedBinding::User {
                prefix: "fake",
                index: 0,
                interpolation: None,
            }),
            None => Err(EntryPointError::MissingBindTarget(res_binding.clone())),
        }
    }

    const fn resolve_push_constants(
        &self,
        stage: crate::ShaderStage,
    ) -> Result<ResolvedBinding, EntryPointError> {
        let slot = match stage {
            crate::ShaderStage::Vertex => self.per_stage_map.vs.push_constant_buffer,
            crate::ShaderStage::Fragment => self.per_stage_map.fs.push_constant_buffer,
            crate::ShaderStage::Compute => self.per_stage_map.cs.push_constant_buffer,
        };
        match slot {
            Some(slot) => Ok(ResolvedBinding::Resource(BindTarget {
                buffer: Some(slot),
                texture: None,
                sampler: None,
                binding_array_size: None,
                mutable: false,
            })),
            None if self.fake_missing_bindings => Ok(ResolvedBinding::User {
                prefix: "fake",
                index: 0,
                interpolation: None,
            }),
            None => Err(EntryPointError::MissingPushConstants),
        }
    }

    fn resolve_sizes_buffer(
        &self,
        stage: crate::ShaderStage,
    ) -> Result<ResolvedBinding, EntryPointError> {
        let slot = self.per_stage_map[stage].sizes_buffer;
        match slot {
            Some(slot) => Ok(ResolvedBinding::Resource(BindTarget {
                buffer: Some(slot),
                texture: None,
                sampler: None,
                binding_array_size: None,
                mutable: false,
            })),
            None if self.fake_missing_bindings => Ok(ResolvedBinding::User {
                prefix: "fake",
                index: 0,
                interpolation: None,
            }),
            None => Err(EntryPointError::MissingSizesBuffer),
        }
    }
}

impl ResolvedBinding {
    fn as_inline_sampler<'a>(&self, options: &'a Options) -> Option<&'a sampler::InlineSampler> {
        match *self {
            Self::Resource(BindTarget {
                sampler: Some(BindSamplerTarget::Inline(index)),
                ..
            }) => Some(&options.inline_samplers[index as usize]),
            _ => None,
        }
    }

    const fn as_bind_target(&self) -> Option<&BindTarget> {
        match *self {
            Self::Resource(ref target) => Some(target),
            _ => None,
        }
    }

    fn try_fmt<W: Write>(&self, out: &mut W) -> Result<(), Error> {
        write!(out, " [[")?;
        match *self {
            Self::BuiltIn(built_in) => {
                use crate::BuiltIn as Bi;
                let name = match built_in {
                    Bi::Position { invariant: false } => "position",
                    Bi::Position { invariant: true } => "position, invariant",
                    // vertex
                    Bi::BaseInstance => "base_instance",
                    Bi::BaseVertex => "base_vertex",
                    Bi::ClipDistance => "clip_distance",
                    Bi::InstanceIndex => "instance_id",
                    Bi::PointSize => "point_size",
                    Bi::VertexIndex => "vertex_id",
                    // fragment
                    Bi::FragDepth => "depth(any)",
                    Bi::PointCoord => "point_coord",
                    Bi::FrontFacing => "front_facing",
                    Bi::PrimitiveIndex => "primitive_id",
                    Bi::SampleIndex => "sample_id",
                    Bi::SampleMask => "sample_mask",
                    // compute
                    Bi::GlobalInvocationId => "thread_position_in_grid",
                    Bi::LocalInvocationId => "thread_position_in_threadgroup",
                    Bi::LocalInvocationIndex => "thread_index_in_threadgroup",
                    Bi::WorkGroupId => "threadgroup_position_in_grid",
                    Bi::WorkGroupSize => "dispatch_threads_per_threadgroup",
                    Bi::NumWorkGroups => "threadgroups_per_grid",
                    Bi::CullDistance | Bi::ViewIndex => {
                        return Err(Error::UnsupportedBuiltIn(built_in))
                    }
                };
                write!(out, "{name}")?;
            }
            Self::Attribute(index) => write!(out, "attribute({index})")?,
            Self::Color(index) => write!(out, "color({index})")?,
            Self::User {
                prefix,
                index,
                interpolation,
            } => {
                write!(out, "user({prefix}{index})")?;
                if let Some(interpolation) = interpolation {
                    write!(out, ", ")?;
                    interpolation.try_fmt(out)?;
                }
            }
            Self::Resource(ref target) => {
                if let Some(id) = target.buffer {
                    write!(out, "buffer({id})")?;
                } else if let Some(id) = target.texture {
                    write!(out, "texture({id})")?;
                } else if let Some(BindSamplerTarget::Resource(id)) = target.sampler {
                    write!(out, "sampler({id})")?;
                } else {
                    return Err(Error::UnimplementedBindTarget(target.clone()));
                }
            }
        }
        write!(out, "]]")?;
        Ok(())
    }
}

impl ResolvedInterpolation {
    const fn from_binding(interpolation: crate::Interpolation, sampling: crate::Sampling) -> Self {
        use crate::Interpolation as I;
        use crate::Sampling as S;

        match (interpolation, sampling) {
            (I::Perspective, S::Center) => Self::CenterPerspective,
            (I::Perspective, S::Centroid) => Self::CentroidPerspective,
            (I::Perspective, S::Sample) => Self::SamplePerspective,
            (I::Linear, S::Center) => Self::CenterNoPerspective,
            (I::Linear, S::Centroid) => Self::CentroidNoPerspective,
            (I::Linear, S::Sample) => Self::SampleNoPerspective,
            (I::Flat, _) => Self::Flat,
        }
    }

    fn try_fmt<W: Write>(self, out: &mut W) -> Result<(), Error> {
        let identifier = match self {
            Self::CenterPerspective => "center_perspective",
            Self::CenterNoPerspective => "center_no_perspective",
            Self::CentroidPerspective => "centroid_perspective",
            Self::CentroidNoPerspective => "centroid_no_perspective",
            Self::SamplePerspective => "sample_perspective",
            Self::SampleNoPerspective => "sample_no_perspective",
            Self::Flat => "flat",
        };
        out.write_str(identifier)?;
        Ok(())
    }
}

/// Information about a translated module that is required
/// for the use of the result.
pub struct TranslationInfo {
    /// Mapping of the entry point names. Each item in the array
    /// corresponds to an entry point index.
    ///
    ///Note: Some entry points may fail translation because of missing bindings.
    pub entry_point_names: Vec<Result<String, EntryPointError>>,
}

pub fn write_string(
    module: &crate::Module,
    info: &ModuleInfo,
    options: &Options,
    pipeline_options: &PipelineOptions,
) -> Result<(String, TranslationInfo), Error> {
    let mut w = writer::Writer::new(String::new());
    let info = w.write(module, info, options, pipeline_options)?;
    Ok((w.finish(), info))
}

#[test]
fn test_error_size() {
    use std::mem::size_of;
    assert_eq!(size_of::<Error>(), 32);
}
